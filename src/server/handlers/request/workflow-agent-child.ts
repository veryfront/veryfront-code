import { instrumentConversationRunFetch } from "#veryfront/agent/conversation/durable.ts";
import type { StepExecutorConfig } from "#veryfront/workflow/executor/step-executor.ts";
import { acceptWorkflowInheritedRunAdmission } from "#veryfront/agent/hosted/terminal-credential.ts";
import { runInheritedLocalAgent } from "./inherited-local-agent.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { readProjectExecutionParent } from "./project-run-parent.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

const hostFetch = globalThis.fetch;
const stringify = JSON.stringify;
/** Trusted ingress owns these credentials; neither workflow context nor the local agent receives them. */
export function createWorkflowAgentNodeRunner(binding: {
  runId: string;
  projectId: string;
  apiUrl: string;
  eventToken?: string;
  authToken: string;
  fetch?: typeof globalThis.fetch;
}): NonNullable<StepExecutorConfig["runAgentNode"]> {
  const send = instrumentConversationRunFetch(binding.fetch ?? hostFetch);
  return async (invocation) => {
    const { canonicalRunId: parentId, attemptId } = readProjectExecutionParent(
      binding.eventToken ?? "",
      binding.runId,
      binding.projectId,
    );
    if (invocation.runId !== binding.runId || !invocation.nodeId || !binding.authToken) {
      throw ORCHESTRATION_ERROR.create({ detail: "Workflow child invocation binding mismatch" });
    }
    const path = invocation.executionPath ?? [];
    const nodeId = path.length > 0 || invocation.nodeId.startsWith("workflow-node:") ||
        invocation.nodeId.length > 128
      ? `workflow-node:${await computeHash(stringify([path, invocation.nodeId]))}`
      : invocation.nodeId;
    const key = await computeHash(`${parentId}:${nodeId}`);
    const startKey = await computeHash(`${parentId}:${attemptId}:${nodeId}`);
    const signal = invocation.signal
      ? AbortSignal.any([invocation.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    const started = await send(`${binding.apiUrl}/runs/${parentId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${binding.eventToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `workflow-node-start:${startKey}`,
      },
      body: stringify({ events: [{ type: "STEP_STARTED", stepId: nodeId }] }),
      signal,
    });
    if (!started.ok) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Workflow node start failed (${started.status})`,
      });
    }
    await started.body?.cancel();
    const prompt = typeof invocation.input === "string"
      ? invocation.input
      : stringify(invocation.input);
    const admitted = await send(`${binding.apiUrl}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${binding.authToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `workflow-child:${key}`,
        "X-Veryfront-Run-Execution-Mode": "inherited",
        "X-Veryfront-Run-Event-Token": binding.eventToken!,
      },
      body: stringify({
        project_id: binding.projectId,
        target: { type: "agent", id: invocation.agentId },
        parent_run_id: parentId,
        node_id: nodeId,
        input: { prompt },
      }),
      signal,
    });
    const child = await acceptWorkflowInheritedRunAdmission(admitted, {
      parentRunId: parentId,
      agentId: invocation.agentId,
      projectId: binding.projectId,
      apiUrl: binding.apiUrl,
      fetch: send,
    });
    return await runInheritedLocalAgent(
      child,
      { projectId: binding.projectId, apiUrl: binding.apiUrl, fetch: send },
      invocation.execute,
      invocation.signal,
    );
  };
}
