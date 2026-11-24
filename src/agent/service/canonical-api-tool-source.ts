import { isHostedDelegationToolAllowed } from "../hosted/runtime-request-config.ts";
import { getServerResolvedProjectToolNames } from "../runtime/server-resolved-project-tools.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import { executorToolDefinition, executorToolLimits } from "../hosted/executor-tool-schema.ts";
import type { ExecutorToolCapability } from "../hosted/executor-tool-bridge.ts";
import {
  getRuntimeAgentToolCallIdSchema,
  getRuntimeAgentToolSchema,
} from "../runtime/agent-invocation-contract.ts";
import type { BrokerRuntimeAgentIngress } from "./broker-ingress.ts";

export const CANONICAL_API_TOOL_SOURCE_ID = "canonical-api-tools";

/**
 * API-declared tools execute in the control plane. The runtime only waits for
 * the authenticated result on its own canonical control owner. No source or
 * consuming-project credential is exposed by this capability.
 */
export function createCanonicalApiToolSource<T>(input: {
  ingress: BrokerRuntimeAgentIngress<T>;
  signal: AbortSignal;
  waitForToolResult(toolCallId: string, signal?: AbortSignal): Promise<AgUiResumeValue>;
}): ExecutorToolCapability {
  const run = input.ingress.executor.run;
  const identity = Object.freeze({
    agentId: run.agentId,
    runId: run.runId,
    projectId: run.project.projectId,
    userId: run.requestedByUserId,
    runIdBindsToolAuthorization: true,
  });
  const limits = executorToolLimits();
  const declared = input.ingress.executor.input.tools ?? [];
  if (declared.length > 50) throw new TypeError("Too many canonical API tools");
  const projectTools = getServerResolvedProjectToolNames(
    input.ingress.executor.input.forwardedProps,
  );
  const definitions = new Map(declared.map((value) => {
    const tool = getRuntimeAgentToolSchema().parse(value);
    return [
      tool.name,
      executorToolDefinition({
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema ?? tool.parameters ?? {
          type: "object",
          properties: {},
          additionalProperties: true,
        },
        ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
      }, limits),
    ] as const;
  }));
  if (definitions.size !== declared.length) throw new TypeError("Duplicate canonical API tool");
  for (const name of projectTools) definitions.delete(name);
  for (const name of definitions.keys()) {
    if (!isHostedDelegationToolAllowed(name, input.ingress.executor.input.allowDelegation)) {
      definitions.delete(name);
    }
  }
  const wait = input.waitForToolResult.bind(input);
  const lifetime = input.signal;
  const pending = new Set<string>();
  const assertOwner = (context?: ToolExecutionContext) => {
    lifetime.throwIfAborted();
    context?.abortSignal?.throwIfAborted();
    if (
      context?.agentId !== identity.agentId || context.runId !== identity.runId ||
      context.projectId !== identity.projectId || context.userId !== identity.userId
    ) throw new TypeError("Canonical API tool owner mismatch");
  };
  const source: RemoteToolSource = Object.freeze({
    id: CANONICAL_API_TOOL_SOURCE_ID,
    async listTools(context?: ToolExecutionContext) {
      assertOwner(context);
      return structuredClone([...definitions.values()]);
    },
    async executeTool(
      name: string,
      _args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ) {
      assertOwner(context);
      if (!definitions.has(name)) throw new TypeError("Canonical API tool is not granted");
      const callId = getRuntimeAgentToolCallIdSchema().parse(context?.toolCallId);
      if (pending.has(callId)) throw new TypeError("Canonical API tool call is already pending");
      pending.add(callId);
      try {
        const result = await wait(
          callId,
          AbortSignal.any([lifetime, ...(context?.abortSignal ? [context.abortSignal] : [])]),
        );
        assertOwner(context);
        if (result.isError) {
          throw AGENT_ERROR.create({
            detail: typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result),
          });
        }
        return result.result;
      } finally {
        pending.delete(callId);
      }
    },
  });
  return { source, allowedToolNames: new Set(definitions.keys()), context: identity };
}
