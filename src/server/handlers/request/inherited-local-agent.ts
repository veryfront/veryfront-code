import type { ConversationRunProjection } from "#veryfront/agent/conversation/durable.ts";
import type { StepResult } from "#veryfront/workflow/executor/step-executor.ts";
import {
  hostedInheritedEventWriter,
  hostedInheritedRunAdmitter,
  hostedInheritedTerminalReceipt,
  hostedTerminalRunFinalizer,
  withHostedInheritedLease,
} from "#veryfront/agent/hosted/terminal-credential.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  runWithHostedRunEventWriterCapability,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import {
  type LocalChildResult,
  withLocalChildExecution,
} from "#veryfront/agent/composition/local-child-execution.ts";
import {
  type AgUiRuntimeStreamEvent,
  createAgUiEncoderState,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";
import { coerceWireEvent } from "#veryfront/agent/ag-ui/sse-parser.ts";
import { runInheritedChildExecutionOnce } from "#veryfront/agent/hosted/durable-child-fork-execution.ts";
import {
  type HostedChildLifecycleTerminalState,
  runHostedChildLifecycle,
} from "#veryfront/agent/hosted/child-lifecycle.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";

function childResult(value: unknown): LocalChildResult {
  if (
    !value || typeof value !== "object" || !("text" in value) ||
    typeof value.text !== "string" || !("toolCalls" in value) ||
    typeof value.toolCalls !== "number" || !("status" in value) ||
    typeof value.status !== "string"
  ) throw ORCHESTRATION_ERROR.create({ detail: "Stored local child result is invalid" });
  return {
    text: value.text,
    toolCalls: value.toolCalls,
    status: value.status,
    ...(Object.hasOwn(value, "object") && "object" in value ? { object: value.object } : {}),
  };
}

/** Bind existing local execution and delegation to the authentic inherited child owners. */
export async function runInheritedLocalAgent(
  child: ConversationRunProjection,
  transport: { projectId: string; apiUrl: string; fetch: typeof globalThis.fetch },
  execute: (
    signal?: AbortSignal,
    onEvent?: (event: AgUiRuntimeStreamEvent) => Promise<void>,
  ) => Promise<StepResult>,
  parentSignal?: AbortSignal,
): Promise<StepResult> {
  const receipt = hostedInheritedTerminalReceipt(child);
  if (receipt) {
    return receipt.status === "completed"
      ? { success: true, output: receipt.output, executionTime: 0 }
      : {
        success: false,
        error: receipt.error?.message ?? `Child ${receipt.status}`,
        executionTime: 0,
      };
  }
  const writer = hostedInheritedEventWriter(child);
  const finalize = hostedTerminalRunFinalizer(child);
  const admit = hostedInheritedRunAdmitter(child, transport);
  const mirror = createHostedConversationRunChunkMirrorFromCapability(writer, {
    expectedRunId: child.runId,
    conversationId: child.conversationId,
    latestEventId: child.latestEventId,
    latestExternalEventSequence: child.latestExternalEventSequence,
  });
  if (!writer || !finalize || !admit || !mirror) {
    throw ORCHESTRATION_ERROR.create({ detail: "Inherited local agent authority is unavailable" });
  }
  const encoder = createAgUiEncoderState();
  const startedTools = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();
  const completedTools = new Set<string>();
  const onEvent = async (event: AgUiRuntimeStreamEvent) => {
    if (
      event.type === "tool-input-start" && typeof event.toolCallId === "string" &&
      startedTools.has(event.toolCallId)
    ) return;
    const events = mapRuntimeStreamEventToAgUiEvents(encoder, event).map((
      { event: type, payload },
    ) => coerceWireEvent(type, payload));
    await mirror.appendEvents(
      events.filter((event): event is Record<string, unknown> & { type: string } => {
        if (typeof event.type !== "string") throw new Error("Invalid encoded stream event");
        const id = "toolCallId" in event ? event.toolCallId : undefined;
        if (typeof id !== "string") return true;
        if (event.type === "TOOL_CALL_START") {
          if (startedTools.has(id)) return false;
          startedTools.set(id, typeof event.toolCallName === "string" ? event.toolCallName : "");
        }

        if (event.type === "TOOL_CALL_RESULT") {
          if (completedTools.has(id)) return false;
          completedTools.add(id);
        }
        return true;
      }),
    );
  };
  const admitTool = async (id: string, name: string, input: unknown) => {
    toolInputs.set(
      id,
      input && typeof input === "object" && "agent_id" in input &&
        typeof input.agent_id === "string"
        ? input.agent_id.trim()
        : undefined,
    );
    if (!startedTools.has(id)) {
      await onEvent({ type: "tool-input-start", toolCallId: id, toolName: name });
    }
  };
  let pending: Promise<StepResult> | undefined;
  const persistTerminal = async (state: HostedChildLifecycleTerminalState) => {
    await finalize({
      authToken: "",
      apiUrl: transport.apiUrl,
      conversationId: child.conversationId,
      runId: child.runId,
      status: state.status,
      output: state.output ?? null,
      model: "",
      provider: "",
      terminalErrorCode: state.terminalErrorCode ?? undefined,
      terminalErrorMessage: state.terminalErrorMessage ?? undefined,
    });
  };
  const executeUnderLease = async (signal?: AbortSignal): Promise<StepResult> => {
    const result: StepResult = await runWithHostedRunEventWriterCapability(
      writer,
      () =>
        withLocalChildExecution(
          async (invocation) => {
            const toolCallId = invocation.context?.toolCallId;
            if (!toolCallId) {
              throw ORCHESTRATION_ERROR.create({
                detail: "Durable delegation requires a tool call",
              });
            }
            const attemptSignal = invocation.context?.abortSignal;
            const delegationSignal = signal && attemptSignal
              ? AbortSignal.any([signal, attemptSignal])
              : attemptSignal ?? signal;
            delegationSignal?.throwIfAborted();
            return await runInheritedChildExecutionOnce(
              writer,
              `${child.runId}:${toolCallId}`,
              async (onAdmitted) => {
                const name = startedTools.get(toolCallId);
                const input = toolInputs.get(toolCallId);
                const declaredTarget = name === "invoke_agent" && typeof input === "string"
                  ? input
                  : name?.startsWith("agent_")
                  ? name.slice(6)
                  : undefined;
                if (name !== invocation.toolName || declaredTarget !== invocation.agentId) {
                  throw ORCHESTRATION_ERROR.create({
                    detail: "Local child has no matching admitted tool invocation",
                  });
                }
                await mirror.flush({ abortSignal: delegationSignal, throwOnTimeoutRetry: true });
                delegationSignal?.throwIfAborted();
                const delegated = await admit(toolCallId, invocation.input)({
                  apiUrl: transport.apiUrl,
                  authToken: "",
                  parentRunId: child.runId,
                  projectId: transport.projectId,
                  agentId: invocation.agentId,
                });
                onAdmitted();
                const delegatedResult = await runInheritedLocalAgent(
                  delegated,
                  transport,
                  async (childSignal, onEvent) => {
                    const output = await invocation.execute({ signal: childSignal, onEvent });
                    return { success: output.status !== "error", output, executionTime: 0 };
                  },
                  delegationSignal,
                );
                if (!delegatedResult.success) {
                  throw new Error(delegatedResult.error ?? "Delegated agent failed");
                }
                const output = childResult(delegatedResult.output);
                if (!completedTools.has(toolCallId)) {
                  completedTools.add(toolCallId);
                  await mirror.handleChunk({ type: "tool-output-available", toolCallId, output });
                }
                await mirror.flush({ abortSignal: signal, throwOnTimeoutRetry: true });
                return output;
              },
            );
          },
          () => execute(signal, onEvent),
          onEvent,
          admitTool,
        ),
    ).catch((error: unknown): StepResult => ({
      success: false,
      error: error instanceof Error ? error.message : "Local agent execution failed",
      executionTime: 0,
    }));
    signal?.throwIfAborted();
    await mirror.flush({ abortSignal: signal, throwOnTimeoutRetry: true });
    if (!result.success) throw new Error(result.error ?? "Local agent failed");
    return result;
  };
  try {
    const outcome = await runHostedChildLifecycle({
      adapter: { completed: persistTerminal, failed: persistTerminal, cancelled: persistTerminal },
      execute: async () => {
        try {
          return await withHostedInheritedLease(child, (signal) => {
            pending = executeUnderLease(signal);
            return pending;
          }, parentSignal);
        } catch (error) {
          // Lease races abort local work; terminal persistence must wait for its actual settlement.
          await pending?.catch(() => undefined);
          await mirror.flush({ throwOnTimeoutRetry: true }).catch(() => undefined);
          throw error;
        }
      },
      resolveCompletedState: (result) => ({ status: "completed", output: result.output ?? null }),
      resolveErrorState: (error) => ({
        status: parentSignal?.aborted ? "cancelled" : "failed",
        terminalErrorCode: "WORKFLOW_AGENT_STEP_FAILED",
        terminalErrorMessage: error instanceof Error ? error.message : "Local agent failed",
      }),
    });
    return outcome.status === "completed" ? outcome.result : {
      success: false,
      error: outcome.terminalState.terminalErrorMessage ?? "Local agent failed",
      executionTime: 0,
    };
  } finally {
    mirror.dispose();
  }
}
