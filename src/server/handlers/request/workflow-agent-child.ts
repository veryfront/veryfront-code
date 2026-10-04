import { instrumentConversationRunFetch } from "#veryfront/agent/conversation/durable.ts";
import type { StepExecutorConfig } from "#veryfront/workflow/executor/step-executor.ts";
import { acceptInheritedRunAdmission } from "#veryfront/agent/hosted/terminal-credential.ts";
import { runInheritedLocalAgent } from "./inherited-local-agent.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

const hostFetch = globalThis.fetch;
const parse = JSON.parse;
const stringify = JSON.stringify;
const decode = atob;
const split = String.prototype.split;
const replaceAll = String.prototype.replaceAll;
const apply = Reflect.apply;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Routing hints only: the API validates the unchanged issuer token and its current execution lease. */
function parentIdentity(token: string, runId: string, projectId: string): string {
  try {
    if (!token || token.length > 16384) throw new Error();
    const encoded = apply(split, token, ["."])[1];
    if (typeof encoded !== "string" || !encoded) throw new Error();
    const value = parse(
      decode(apply(replaceAll, apply(replaceAll, encoded, ["-", "+"]), ["_", "/"])),
    );
    if (
      value.tokenUse !== "run_event_writer" || value.runId !== runId ||
      value.projectId !== projectId ||
      typeof value.projectExecutionAttempt?.canonicalRunId !== "string" ||
      !uuid.test(value.projectExecutionAttempt.canonicalRunId) ||
      typeof value.projectExecutionAttempt?.attemptId !== "string" ||
      !value.projectExecutionAttempt.attemptId ||
      typeof value.projectExecutionAttempt?.workerId !== "string" ||
      !value.projectExecutionAttempt.workerId
    ) throw new Error();
    return value.projectExecutionAttempt.canonicalRunId;
  } catch {
    throw ORCHESTRATION_ERROR.create({
      detail: "Workflow child execution requires current run authority",
    });
  }
}

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
    const parentId = parentIdentity(binding.eventToken ?? "", binding.runId, binding.projectId);
    if (invocation.runId !== binding.runId || !invocation.nodeId || !binding.authToken) {
      throw ORCHESTRATION_ERROR.create({ detail: "Workflow child invocation binding mismatch" });
    }
    const key = await computeHash(`${parentId}:${invocation.nodeId}`);
    const signal = invocation.signal
      ? AbortSignal.any([invocation.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    const started = await send(`${binding.apiUrl}/runs/${parentId}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${binding.eventToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `workflow-node-start:${key}`,
      },
      body: stringify({ events: [{ type: "STEP_STARTED", stepId: invocation.nodeId }] }),
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
        node_id: invocation.nodeId,
        input: { prompt },
      }),
      signal,
    });
    const child = await acceptInheritedRunAdmission(admitted, {
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
