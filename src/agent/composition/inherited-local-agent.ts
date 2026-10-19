import { readStructuredAgentOutput } from "../output-schema.ts";
import type { createConnectedLocalPlatformTools } from "../ag-ui/connected-local-platform-tools.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createLocalToolStream } from "../ag-ui/local-tool-stream.ts";
import { bindToolCallStartOccurrence } from "#veryfront/runtime/tool-call-occurrence.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
/** Read only a completed framework response, not arbitrary workflow business data. */
function terminalAgentText(output: unknown): string | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const text = Object.getOwnPropertyDescriptor(output, "text");
  const status = Object.getOwnPropertyDescriptor(output, "status");
  const calls = Object.getOwnPropertyDescriptor(output, "toolCalls");
  // Only unwrap the framework-produced agent response, not arbitrary workflow data.
  if (
    !text || !("value" in text) || typeof text.value !== "string" ||
    !status || !("value" in status) || status.value !== "completed" ||
    !calls || !("value" in calls) ||
    (typeof calls.value !== "number" && !Array.isArray(calls.value))
  ) return undefined;
  return text.value;
}

/** @internal Resolve the durable output stored for an inherited child run. */
export function terminalAgentOutput(output: unknown): unknown {
  if (terminalAgentText(output) === undefined) return output;
  const structured = readStructuredAgentOutput(output);
  return structured ? createMessageFinishObjectObservation(structured.data) : undefined;
}

const localToolAdmissions = createPrivateWeakStore<
  object,
  ((
    call: { occurrenceId: string; toolCallId: string },
    name: string,
    args: Record<string, unknown>,
  ) => Promise<AgentRunToolCallAdmissionReceipt>) | undefined
>();
/** Exact-child bridge retained only while its host-owned mirror is alive. */
export function admitInheritedLocalTool(
  child: ConversationRunProjection | InheritedRunResult,
  call: { occurrenceId: string; toolCallId: string },
  name: string,
  args: Record<string, unknown>,
) {
  const admit = localToolAdmissions.get(child);
  if (!admit) throw new Error("Inherited local tool writer is unavailable");
  return admit(call, name, args);
}
import { createDurableRunEventSink } from "../hosted/durable-run-event-sink.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
  revokeRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import type { ConversationRunProjection } from "#veryfront/agent/conversation/durable.ts";
import type { StepResult } from "#veryfront/workflow/executor/step-executor.ts";
import {
  hostedInheritedEventWriter,
  hostedInheritedInferenceModelResolver,
  hostedInheritedRunAdmitter,
  hostedInheritedTerminalReceipt,
  hostedTerminalRunFinalizer,
  type InheritedRunResult,
  withHostedInheritedLease,
} from "#veryfront/agent/hosted/terminal-credential.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  hostedRunCanonicalId,
  runWithHostedRunEventWriterCapability,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import {
  type LocalChildResult,
  withLocalChildExecution,
} from "#veryfront/agent/composition/local-child-execution.ts";
import {
  type AgUiRuntimeStreamEvent,
  createAgUiEncoderState,
  createMessageFinishObjectObservation,
  mapRuntimeStreamEventToAgUiEvents,
} from "#veryfront/agent/ag-ui/encoder.ts";
import { coerceWireEvent } from "#veryfront/agent/ag-ui/sse-parser.ts";
import { runInheritedChildExecutionOnce } from "#veryfront/agent/hosted/durable-child-fork-execution.ts";
import {
  type HostedChildLifecycleTerminalState,
  runHostedChildLifecycle,
} from "#veryfront/agent/hosted/child-lifecycle.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { sanitizeBoundedDiagnosticText } from "#veryfront/errors/diagnostic-policy.ts";

const apply = Reflect.apply;
const AbortSignalTimeout = AbortSignal.timeout;
const retryDrainSignal = (signal?: AbortSignal) =>
  signal && !signal.aborted
    ? signal
    : apply(AbortSignalTimeout, AbortSignal, [30_000]) as AbortSignal;

/** @internal Validate the result returned by durable local child execution. */
function restoreCanonicalAgentResponse(value: unknown): Record<string, unknown> {
  const invalid = () =>
    ORCHESTRATION_ERROR.create({ detail: "Stored local child result is invalid" });
  if (value === undefined) throw invalid();
  if (value === null) return { text: "", status: "completed" };
  if (typeof value !== "object" || Array.isArray(value)) throw invalid();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "text" && key !== "data")
  ) throw invalid();
  const text = Object.getOwnPropertyDescriptor(value, "text");
  const data = Object.getOwnPropertyDescriptor(value, "data");
  if (
    (text && (!("value" in text) || typeof text.value !== "string")) ||
    (data && !("value" in data))
  ) throw invalid();
  return {
    text: text && "value" in text ? text.value : privateJsonStringify(data!.value),
    ...(data && "value" in data ? { data: data.value, object: data.value } : {}),
    status: "completed",
  };
}

/** Restore the tool protocol while preserving known legacy call counts. */
export function readInheritedLocalChildResult(value: unknown): LocalChildResult {
  const invalid = () =>
    ORCHESTRATION_ERROR.create({ detail: "Stored local child result is invalid" });
  if (typeof value !== "object" || value === null) throw invalid();
  const text = Object.getOwnPropertyDescriptor(value, "text");
  const calls = Object.getOwnPropertyDescriptor(value, "toolCalls");
  const status = Object.getOwnPropertyDescriptor(value, "status");
  if (!text || !("value" in text) || typeof text.value !== "string") throw invalid();
  if (
    !calls || !("value" in calls) ||
    (typeof calls.value !== "number" && !Array.isArray(calls.value))
  ) throw invalid();
  if (!status || !("value" in status) || typeof status.value !== "string") throw invalid();
  const structured = readStructuredAgentOutput(value);
  return {
    text: text.value,
    toolCalls: Array.isArray(calls.value) ? calls.value.length : calls.value,
    status: status.value,
    ...structured,
  };
}

/** Bind existing local execution and delegation to the authentic inherited child owners. */
export async function runInheritedLocalAgent(
  child: ConversationRunProjection | InheritedRunResult,
  transport: {
    projectId: string;
    apiUrl: string;
    fetch: typeof globalThis.fetch;
    restoreAgentResponse?: boolean;
  },
  execute: (
    signal?: AbortSignal,
    onEvent?: (event: AgUiRuntimeStreamEvent) => Promise<void>,
  ) => Promise<StepResult>,
  parentSignal?: AbortSignal,
  resolveProjectModels = false,
  toolCallAdmissions = false,
  platform?: {
    tools: Pick<ReturnType<typeof createConnectedLocalPlatformTools>, "run" | "revoke">;
    agentId: string;
  },
): Promise<StepResult> {
  const receipt = "terminalReceipt" in child
    ? child.terminalReceipt
    : hostedInheritedTerminalReceipt(child);
  if (receipt) {
    return receipt.status === "completed"
      ? {
        success: true,
        output: receipt.outputFormat === "text-data-v1"
          ? restoreCanonicalAgentResponse(receipt.output)
          : receipt.output,
        executionTime: 0,
      }
      : {
        success: false,
        error: receipt.error?.message ?? `Child ${receipt.status}`,
        executionTime: 0,
      };
  }
  if ("terminalReceipt" in child) throw new Error("Inherited terminal receipt is missing");
  const writer = hostedInheritedEventWriter(child);
  const finalize = hostedTerminalRunFinalizer(child);
  const admit = hostedInheritedRunAdmitter(child, transport, true);
  const mirror = createHostedConversationRunChunkMirrorFromCapability(writer, {
    expectedRunId: child.runId,
    conversationId: child.conversationId,
    latestEventId: child.latestEventId,
    latestExternalEventSequence: child.latestExternalEventSequence,
    runtimeObservations: true,
    ...(toolCallAdmissions ? { toolCallAdmissions: true as const } : {}),
  });
  if (!writer || !finalize || !admit || !mirror) {
    throw ORCHESTRATION_ERROR.create({ detail: "Inherited local agent authority is unavailable" });
  }
  const canonicalRunId = hostedRunCanonicalId(writer, child.runId);
  if (!canonicalRunId) throw new Error("Inherited child canonical identity is unavailable");
  let observedText = "";
  const appendObservedEvents: typeof mirror.appendEvents = async (events) => {
    for (const event of events) {
      if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
        observedText += event.delta;
      }
    }
    await mirror.appendEvents(events);
  };
  const modelSink = createDurableRunEventSink({
    mirror: { ...mirror, appendEvents: appendObservedEvents },
    abortSignal: parentSignal,
  });
  const observationWriter = createRuntimeObservationWriterCapability({
    scope: { runId: child.runId, canonicalRunId, projectId: transport.projectId },
  });
  bindRuntimeObservationWriterCapability(modelSink, observationWriter);
  const encoder = createAgUiEncoderState();
  const startedTools = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();
  const completedTools = new Set<string>();
  const toolStream = toolCallAdmissions ? createLocalToolStream() : undefined;
  const onEvent = async (event: AgUiRuntimeStreamEvent) => {
    if (
      event.type === "tool-input-start" && typeof event.toolCallId === "string" &&
      startedTools.has(event.toolCallId) && !toolStream
    ) return;
    const events = mapRuntimeStreamEventToAgUiEvents(encoder, event).map((
      { event: type, payload },
    ) => coerceWireEvent(type, payload));
    const filtered = events.filter((event): event is Record<string, unknown> & { type: string } => {
      if (typeof event.type !== "string") throw new Error("Invalid encoded stream event");
      const id = "toolCallId" in event ? event.toolCallId : undefined;
      if (typeof id !== "string") return true;
      if (event.type === "TOOL_CALL_START") {
        if (startedTools.has(id) && !toolStream) return false;
        startedTools.set(id, typeof event.toolCallName === "string" ? event.toolCallName : "");
      }

      if (event.type === "TOOL_CALL_RESULT") {
        if (completedTools.has(id)) return false;
        completedTools.add(id);
      }
      return true;
    });
    await appendObservedEvents(toolStream ? toolStream.encode(filtered) : filtered);
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
  localToolAdmissions.set(child, async (call, name) => {
    const start = {
      type: "tool-input-start" as const,
      toolCallId: call.toolCallId,
      toolName: name,
    };
    bindToolCallStartOccurrence(start, call.occurrenceId);
    await mirror.handleChunk(start);
    startedTools.set(call.toolCallId, name);
    await mirror.flush({
      abortSignal: retryDrainSignal(parentSignal),
      throwOnTimeoutRetry: true,
      waitForRetries: true,
    });
    await mirror.appendEvents(toolStream?.admit(call.toolCallId) ?? []);
    const receipt = mirror.takeToolCallAdmissionReceipt?.(call.occurrenceId);
    if (!receipt) throw new Error("Inherited local tool admission missing");
    return receipt;
  });
  let pending: Promise<StepResult> | undefined;
  let platformRevoked = false;
  const revokePlatformTools = async () => {
    if (!platform || platformRevoked) return;
    await platform.tools.revoke(child);
    platformRevoked = true;
  };
  const persistTerminal = async (state: HostedChildLifecycleTerminalState) => {
    let drainFailure: { error: unknown } | undefined;
    try {
      const text = state.status === "completed" ? terminalAgentText(state.output) : undefined;
      // A generate middleware can return a cached response without observing a provider turn.
      if (!observedText && text) {
        await onEvent({ type: "text-delta", id: `${child.messageId}:returned-text`, delta: text });
      }
      await mirror.appendEvents(toolStream?.finish() ?? []);
      await mirror.flush({
        abortSignal: retryDrainSignal(parentSignal),
        throwOnTimeoutRetry: true,
        waitForRetries: true,
      });
    } catch (error) {
      drainFailure = { error };
    }
    const terminalState: HostedChildLifecycleTerminalState =
      drainFailure && state.status === "completed"
        ? {
          status: "failed",
          terminalErrorCode: "DURABLE_RUN_EVENT_PERSISTENCE_FAILED",
          terminalErrorMessage: "Child run events could not be persisted",
        }
        : state;
    // Finalization must not be skipped by a transient sandbox close failure.
    // The outer finally retries the retained cleanup before releasing the owner.
    try {
      await revokePlatformTools();
    } catch { /* Retained cleanup is retried by the owner-lifetime finally. */ }
    await finalize({
      authToken: "",
      apiUrl: transport.apiUrl,
      conversationId: child.conversationId,
      runId: child.runId,
      status: terminalState.status,
      output: terminalAgentOutput(terminalState.output),
      ...(terminalState.status === "completed" &&
          terminalAgentText(terminalState.output) !== undefined &&
          terminalAgentText(terminalState.output) !== observedText
        ? { finalText: terminalAgentText(terminalState.output) }
        : {}),
      model: "",
      provider: "",
      terminalErrorCode: terminalState.terminalErrorCode ?? undefined,
      terminalErrorMessage: terminalState.terminalErrorMessage ?? undefined,
    });
    if (drainFailure) throw drainFailure.error;
  };
  const executeUnderLease = async (signal?: AbortSignal): Promise<StepResult> => {
    const result: StepResult = await runWithMandatoryRunEventSink(
      modelSink,
      () =>
        runWithHostedRunEventWriterCapability(
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
                    const declaredTarget =
                      (name === "invoke_agent" || name === "veryfront__invoke_agent") &&
                        typeof input === "string"
                        ? input
                        : name?.startsWith("agent_")
                        ? name.slice(6)
                        : undefined;
                    if (name !== invocation.toolName || declaredTarget !== invocation.agentId) {
                      throw ORCHESTRATION_ERROR.create({
                        detail: "Local child has no matching admitted tool invocation",
                      });
                    }
                    await mirror.flush({
                      abortSignal: delegationSignal,
                      throwOnTimeoutRetry: true,
                    });
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
                        const output = await invocation.execute({
                          signal: childSignal,
                          runId: "terminalReceipt" in delegated ? undefined : delegated.runId,
                          onEvent,
                          resolveModelRuntime: "terminalReceipt" in delegated
                            ? undefined
                            : hostedInheritedInferenceModelResolver(delegated, {
                              projectModels: resolveProjectModels,
                              signal: childSignal,
                            }),
                        });
                        return { success: output.status !== "error", output, executionTime: 0 };
                      },
                      delegationSignal,
                      resolveProjectModels,
                      toolCallAdmissions,
                      platform ? { tools: platform.tools, agentId: invocation.agentId } : undefined,
                    );
                    if (!delegatedResult.success) {
                      throw new Error(delegatedResult.error ?? "Delegated agent failed");
                    }
                    const output = "terminalReceipt" in delegated &&
                        delegated.terminalReceipt.outputFormat === "text-data-v1"
                      ? delegatedResult.output as LocalChildResult
                      : readInheritedLocalChildResult(delegatedResult.output);
                    if (!completedTools.has(toolCallId)) {
                      completedTools.add(toolCallId);
                      await mirror.handleChunk({
                        type: "tool-output-available",
                        toolCallId,
                        output,
                      });
                    }
                    await mirror.flush({ abortSignal: signal, throwOnTimeoutRetry: true });
                    return output;
                  },
                );
              },
              () =>
                platform
                  ? platform.tools.run({
                    owner: child,
                    scope: {
                      projectId: transport.projectId,
                      runId: child.runId,
                      agentId: platform.agentId,
                    },
                    canonicalRunId,
                    writer,
                    signal: signal ?? parentSignal ?? new AbortController().signal,
                    admit: (call, name, args) => admitInheritedLocalTool(child, call, name, args),
                  }, () => execute(signal, onEvent))
                  : execute(signal, onEvent),
              onEvent,
              admitTool,
            ),
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
        terminalErrorMessage: sanitizeBoundedDiagnosticText(
          error instanceof Error ? error.message : "Local agent failed",
        ),
      }),
    });
    return outcome.status === "completed" ? outcome.result : {
      success: false,
      error: outcome.terminalState.terminalErrorMessage ?? "Local agent failed",
      executionTime: 0,
    };
  } finally {
    try {
      await revokePlatformTools();
    } finally {
      localToolAdmissions.set(child, undefined);
      revokeRuntimeObservationWriterCapability(observationWriter);
      mirror.dispose();
    }
  }
}
