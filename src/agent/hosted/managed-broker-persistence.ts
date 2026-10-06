import { terminalRoute } from "../conversation/terminal-route.ts";
import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import {
  type ConversationRunProjection,
  getConversationRunProjectionSchema,
} from "../conversation/durable-contracts.ts";
import {
  type ConversationHostedTerminalStateInput,
  createConversationHostedTerminalAdapter,
  resolveConversationHostedStreamErrorState,
} from "../conversation/hosted-terminal.ts";
import {
  finalizeConversationAgentRun,
  instrumentConversationRunFetch,
} from "../conversation/durable.ts";
import { createDurableRunEventSink } from "./durable-run-event-sink.ts";
import {
  bindHostedToolCallAdmissionWriter,
  createHostedConversationRunChunkMirrorFromCapability,
  createHostedRunEventWriterCapability,
  hostedRunCanonicalId,
  type HostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  createToolExposureCheckpointEvent,
  type ToolExposureCheckpoint,
} from "../runtime/tool-exposure.ts";
import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "../runtime/provider-replay.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import type { HostedExecutorOwnedWork } from "./executor-session.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { getToolCallOccurrence } from "#veryfront/runtime/tool-call-occurrence.ts";
import { isObservedToolResultStart } from "#veryfront/runtime/tool-call-occurrence-carrier.ts";
import {
  type AgentRunToolCallAdmissionReceipt,
  getToolCallAdmissionReceiptSchema,
} from "#veryfront/runtime/tool-call-admission-receipt.ts";
import {
  type AdmitExecutorToolCall,
  bindToolCallAdmissionOwner,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";

const getAdmissionScopeSchema = defineSchema((v) =>
  v.object({ projectId: v.string().uuid() }).strict()
);

/** Acknowledging output writes and terminal finalization for a canonical run. */
export interface ManagedBrokerOutput {
  write(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void>;
  finish(input: {
    completed: boolean;
    paused?: true;
    output?: unknown;
    error?: unknown;
    metadata?: HostedLifecycleTerminalState["metadata"];
  }): Promise<void>;
}

/** Opaque, exact-run completion authority created by the trusted broker. */
export interface ManagedBrokerTerminal {
  readonly kind: "managed-broker-terminal";
}

const freezeTerminal = Object.freeze;
const terminalStates = createPrivateWeakStore<ManagedBrokerTerminal, {
  runId: string;
  dispatch(state: ConversationHostedTerminalStateInput): Promise<HostedLifecycleTerminalState>;
}>();

/** Bind API completion credentials and transport privately to one canonical run. */
export function createManagedBrokerTerminal(input: {
  apiUrl: string;
  completionAuthToken: string;
  terminalAuthToken: string;
  run: ConversationRunProjection;
  modelId: string;
  resolveProvider(modelId: string): string;
  fetch?: typeof globalThis.fetch;
}): ManagedBrokerTerminal {
  const run = getConversationRunProjectionSchema().parse(input.run);
  if (typeof input.completionAuthToken !== "string" || !input.completionAuthToken.trim()) {
    throw new TypeError("Managed broker requires completion authorization");
  }
  const { apiUrl, completionAuthToken, terminalAuthToken, fetch: transport } = input;
  terminalRoute(terminalAuthToken, run.runId);
  const resolveProvider = input.resolveProvider;
  const adapter = createConversationHostedTerminalAdapter({
    apiUrl: input.apiUrl,
    authToken: input.completionAuthToken,
    run,
    fallbackModelId: input.modelId,
    finalize: (value) =>
      finalizeConversationAgentRun({
        ...value,
        apiUrl,
        authToken: completionAuthToken,
        terminalAuthToken,
        fetch: transport ? instrumentConversationRunFetch(transport) : undefined,
      }),
    // Do not expose secret-bearing adapter options as the caller's receiver.
    resolveProvider: (modelId) => resolveProvider(modelId),
    // A trusted completion transport joins the active execution trace like
    // capability-backed event appends; an omitted transport already resolves
    // to the instrumented default.
    fetch: input.fetch ? instrumentConversationRunFetch(input.fetch) : undefined,
  });
  const terminal = freezeTerminal({ kind: "managed-broker-terminal" as const });
  terminalStates.set(terminal, { runId: run.runId, dispatch: adapter.dispatch });
  return terminal;
}

/** Create exact-run API persistence callbacks while retaining credentials in the broker. */
export function createManagedBrokerPersistence(input: {
  apiUrl: string;
  runEventToken: string;
  /** Application authority accepted by the API completion route, never the append token. */
  completionAuthToken: string;
  terminalAuthToken: string;
  run: ConversationRunProjection;
  modelId: string;
  resolveProvider(modelId: string): string;
  fetch?: typeof globalThis.fetch;
  /** Trusted migration opt-in. Requires API support and a project-bound generation writer. */
  toolCallAdmissions?: { projectId: string };
  /** Trusted migration opt-in. Disabled until the API accepts runtime_observations. */
  runtimeObservations?: { projectId: string };
}) {
  const run = getConversationRunProjectionSchema().parse(input.run);
  if (
    typeof input.completionAuthToken !== "string" || !input.completionAuthToken.trim() ||
    input.completionAuthToken === input.runEventToken
  ) {
    throw new TypeError("Managed broker requires independent completion authorization");
  }
  const terminal = createManagedBrokerTerminal({ ...input, run });
  return createManagedBrokerPersistenceFromCapability({
    capability: createHostedRunEventWriterCapability({
      apiUrl: input.apiUrl,
      runId: run.runId,
      canonicalRunId: terminalRoute(input.terminalAuthToken, run.runId).id,
      runEventAppendToken: input.runEventToken,
      fetch: input.fetch,
    }),
    run,
    terminal,
    ...(input.toolCallAdmissions ? { toolCallAdmissions: input.toolCallAdmissions } : {}),
    ...(input.runtimeObservations ? { runtimeObservations: input.runtimeObservations } : {}),
  });
}

/** Create exact-run persistence from opaque broker authority with pinned API transport. */
export function createManagedBrokerPersistenceFromCapability(input: {
  capability: HostedRunEventWriterCapability;
  run: ConversationRunProjection;
  terminal: ManagedBrokerTerminal;
  toolCallAdmissions?: { projectId: string };
  runtimeObservations?: { projectId: string };
}) {
  const run = getConversationRunProjectionSchema().parse(input.run);
  if (run.status !== "pending" && run.status !== "running" && run.status !== "waiting_for_tool") {
    throw new TypeError("Managed broker persistence requires an active run");
  }
  const terminalState = terminalStates.get(input.terminal);
  if (!terminalState || terminalState.runId !== run.runId) {
    throw new TypeError("Managed broker terminal authority is not bound to this run");
  }
  const dispatchTerminal = terminalState.dispatch;
  const admissionScope = input.toolCallAdmissions === undefined
    ? undefined
    : getAdmissionScopeSchema().parse(input.toolCallAdmissions);
  const runtimeObservationScope = input.runtimeObservations === undefined
    ? undefined
    : getAdmissionScopeSchema().parse(input.runtimeObservations);
  const canonicalRunId = hostedRunCanonicalId(input.capability, run.runId);
  if (admissionScope && !canonicalRunId) {
    throw new TypeError("Tool-call admissions require an exact canonical run writer");
  }
  if (runtimeObservationScope && !canonicalRunId) {
    throw new TypeError("Runtime observations require an exact canonical run writer");
  }
  const toolAdmissions = createPrivateMap<string, {
    receipt?: AgentRunToolCallAdmissionReceipt;
    waiter?: {
      resolve(receipt: AgentRunToolCallAdmissionReceipt): void;
      reject(error: unknown): void;
    };
    claimed?: true;
  }>();
  const rejectToolAdmissions = (error: unknown) => {
    for (const admission of toolAdmissions.values()) admission.waiter?.reject(error);
  };
  let sessionOwnedWork: HostedExecutorOwnedWork | undefined;
  let retainedPersistenceTail = Promise.resolve();
  let cleaned = false;
  const runQueueFlush = <T>(operation: () => Promise<T>): Promise<T> => {
    const owner = sessionOwnedWork;
    if (!owner) {
      return Promise.reject(new TypeError("Managed broker persistence is not session-bound"));
    }
    const owned = owner(operation);
    const settled = owned.then(() => undefined, () => undefined);
    retainedPersistenceTail = Promise.all([retainedPersistenceTail, settled]).then(() => undefined);
    return owned;
  };
  const mirror = createHostedConversationRunChunkMirrorFromCapability(input.capability, {
    expectedRunId: run.runId,
    conversationId: run.conversationId,
    latestEventId: run.latestEventId,
    latestExternalEventSequence: run.latestExternalEventSequence,
    runQueueFlush,
    ...(admissionScope ? { toolCallAdmissions: true } : {}),
    ...(runtimeObservationScope ? { runtimeObservations: true } : {}),
  });
  if (!mirror) throw new TypeError("Managed broker run-event capability is not bound");
  const durableMirror = mirror;
  const durableSink = createDurableRunEventSink({ mirror: durableMirror });
  let tail = Promise.resolve();
  let failure: unknown;
  let failed = false;
  let finished = false;

  const queue = <T>(
    operation: (priorFailure: { failed: boolean; error: unknown }) => Promise<T>,
    terminal = false,
  ): Promise<T> => {
    if (cleaned) return Promise.reject(new TypeError("Managed broker persistence is closed"));
    if (!sessionOwnedWork) {
      return Promise.reject(new TypeError("Managed broker persistence is not session-bound"));
    }
    if (finished && !terminal) {
      return Promise.reject(new TypeError("Managed broker persistence is finished"));
    }
    const current = tail.then(async () => {
      const priorFailure = { failed, error: failure };
      if (priorFailure.failed && !terminal) throw priorFailure.error;
      try {
        const result = await operation(priorFailure);
        if (priorFailure.failed) throw priorFailure.error;
        return result;
      } catch (error) {
        if (priorFailure.failed) throw priorFailure.error;
        failure = error;
        failed = true;
        rejectToolAdmissions(error);
        throw error;
      }
    });
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
  const flush = async () => {
    const snapshot = await durableMirror.flush({ throwOnTimeoutRetry: true });
    if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
      throw new TypeError("Managed broker output was not durably persisted");
    }
  };
  const persistEvents = (events: ConversationRunEvent[]) =>
    queue(async () => {
      await durableMirror.appendEvents(events);
      await flush();
    });
  const modelRunEventSink: AgentRunEventSink = (event) =>
    queue(async () => await durableSink(event));
  const output: ManagedBrokerOutput = {
    write(chunk) {
      if (finished) return Promise.reject(new TypeError("Managed broker output is finished"));
      return queue(async () => {
        await durableMirror.handleChunk(chunk);
        await flush();
        if (
          admissionScope && chunk.type === "tool-input-start" &&
          !isObservedToolResultStart(chunk)
        ) {
          const occurrenceId = getToolCallOccurrence(chunk);
          const acknowledged = occurrenceId &&
            durableMirror.takeToolCallAdmissionReceipt?.(occurrenceId);
          const parsed = getToolCallAdmissionReceiptSchema().safeParse(acknowledged);
          if (
            !parsed.success || parsed.data.toolCallId !== chunk.toolCallId ||
            parsed.data.projectId.toLowerCase() !== admissionScope.projectId.toLowerCase() ||
            parsed.data.runId.toLowerCase() !== canonicalRunId!.toLowerCase() ||
            parsed.data.occurrenceId !== occurrenceId
          ) {
            throw new DurableRunEventPersistenceError("Tool start admission is missing or invalid");
          }
          const admission = toolAdmissions.get(occurrenceId!) ?? {};
          if (admission.receipt) {
            throw new DurableRunEventPersistenceError(
              "Tool start occurrence was already persisted",
            );
          }
          admission.receipt = Object.freeze(parsed.data);
          toolAdmissions.set(occurrenceId!, admission);
          admission.waiter?.resolve(admission.receipt);
        }
      });
    },
    finish(result) {
      if (finished) return Promise.reject(new TypeError("Managed broker output is finished"));
      if (!sessionOwnedWork) {
        return Promise.reject(new TypeError("Managed broker persistence is not session-bound"));
      }
      if (result.paused && (result.completed || result.error !== undefined)) {
        return Promise.reject(new TypeError("Paused managed output cannot be terminal"));
      }
      if (result.completed && result.error !== undefined) {
        return Promise.reject(new TypeError("Completed managed output cannot carry an error"));
      }
      finished = true;
      return queue(async (priorFailure) => {
        // Terminal reporting is an independent best-effort path: even a poisoned
        // write tail or final drain must attempt a failed terminal update, while
        // callers still receive the original persistence error.
        let terminalFailure = priorFailure;
        if (!terminalFailure.failed) {
          try {
            await flush();
          } catch (error) {
            terminalFailure = { failed: true, error };
          }
        }
        if (result.paused) {
          if (terminalFailure.failed) throw terminalFailure.error;
          return;
        }
        try {
          if (terminalFailure.failed) {
            await dispatchTerminal(
              {
                ...resolveConversationHostedStreamErrorState(terminalFailure.error),
                metadata: result.metadata,
              },
            );
          } else if (result.completed) {
            await dispatchTerminal({
              status: "completed",
              output: result.output,
              metadata: result.metadata,
            });
          } else if (result.error !== undefined) {
            await dispatchTerminal({
              ...resolveConversationHostedStreamErrorState(result.error),
              metadata: result.metadata,
            });
          } else {
            await dispatchTerminal({
              status: "cancelled",
              terminalErrorCode: "ABORTED",
              terminalErrorMessage: "Managed executor output was cancelled",
              metadata: result.metadata,
            });
          }
        } catch (terminalDispatchError) {
          if (terminalFailure.failed) throw terminalFailure.error;
          throw terminalDispatchError;
        }
        if (terminalFailure.failed && !priorFailure.failed) throw terminalFailure.error;
      }, true);
    },
  };
  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;
    rejectToolAdmissions(new DurableRunEventPersistenceError("Tool-call admission owner closed"));
    toolAdmissions.clear();
    await tail;
    await retainedPersistenceTail;
    durableMirror.dispose();
  }
  function bindSessionOwnedWork(owner: HostedExecutorOwnedWork): void {
    if (typeof owner !== "function") {
      throw new TypeError("Managed broker persistence owner must be a function");
    }
    if (cleaned) throw new TypeError("Managed broker persistence is closed");
    if (sessionOwnedWork) {
      throw new TypeError("Managed broker persistence is already session-bound");
    }
    sessionOwnedWork = owner;
  }
  const admitToolCall: AdmitExecutorToolCall | undefined = admissionScope
    ? async (call, signal) => {
      signal.throwIfAborted();
      if (cleaned || finished || failed || !sessionOwnedWork) {
        throw new DurableRunEventPersistenceError("Tool-call admission owner is inactive");
      }
      const occurrenceId = call.occurrenceId.toLowerCase();
      const admission = toolAdmissions.get(occurrenceId) ?? {};
      if (admission.claimed) {
        throw new DurableRunEventPersistenceError("Tool-call occurrence was already dispatched");
      }
      admission.claimed = true;
      toolAdmissions.set(occurrenceId, admission);
      const receipt = admission.receipt ?? await new Promise<AgentRunToolCallAdmissionReceipt>(
        (resolve, reject) => {
          const abort = () => reject(signal.reason);
          const settle = (operation: () => void) => {
            signal.removeEventListener("abort", abort);
            operation();
          };
          admission.waiter = {
            resolve: (value) => settle(() => resolve(value)),
            reject: (error) => settle(() => reject(error)),
          };
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        },
      );
      signal.throwIfAborted();
      if (cleaned || finished || failed || receipt.toolCallId !== call.toolCallId) {
        throw new DurableRunEventPersistenceError("Tool-call admission no longer matches dispatch");
      }
      return receipt;
    }
    : undefined;
  if (admitToolCall) {
    bindHostedToolCallAdmissionWriter(admitToolCall, {
      capability: input.capability,
      expectedRunId: run.runId,
      projectId: admissionScope!.projectId,
    });
    bindToolCallAdmissionOwner(admitToolCall, {
      runId: run.runId,
      canonicalRunId: canonicalRunId!,
      projectId: admissionScope!.projectId,
    });
  }
  return {
    bindSessionOwnedWork,
    modelRunEventSink,
    ...(admitToolCall ? { admitToolCall } : {}),
    publishParentRunEvents: persistEvents,
    persistToolExposureCheckpoint: (checkpoint: ToolExposureCheckpoint) =>
      persistEvents([createToolExposureCheckpointEvent(checkpoint)]),
    persistProviderReplayCheckpoint: (checkpoint: ProviderReplayCheckpoint) =>
      persistEvents([createProviderReplayCheckpointEvent(checkpoint)]),
    output,
    cleanup,
  };
}
