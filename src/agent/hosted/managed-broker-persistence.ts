import {
  type RuntimeConfigurationReference,
  snapshotRuntimeConfigurationReference,
} from "../runtime/runtime-configuration-reference.ts";
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
import {
  bindManagedToolResultFence,
  createManagedToolResultFence,
} from "./managed-tool-result-fence.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";

const getAdmissionScopeSchema = defineSchema((v) =>
  v.object({ projectId: v.string().uuid() }).strict()
);

/** Authenticated run state needed by broker persistence, without legacy UI projection fields. */
export type ManagedBrokerRunSnapshot =
  & Pick<
    ConversationRunProjection,
    | "canonicalRunId"
    | "runId"
    | "conversationId"
    | "messageId"
    | "latestEventId"
    | "latestExternalEventSequence"
    | "status"
  >
  & { readonly runtimeConfiguration?: RuntimeConfigurationReference };

const getManagedBrokerRunSnapshotSchema = defineSchema((v) =>
  v.object({
    canonicalRunId: v.string().uuid().optional(),
    runId: v.string().min(1),
    conversationId: v.string().uuid(),
    messageId: v.string().uuid(),
    latestEventId: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    latestExternalEventSequence: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    status: v.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"]),
  })
);

function readManagedBrokerRunSnapshot(
  value: ConversationRunProjection | ManagedBrokerRunSnapshot,
): ManagedBrokerRunSnapshot {
  // Preserve the existing camel/snake response normalization. This decodes
  // supplied admission state; it never reads a legacy run projection endpoint.
  const descriptor = Object.getOwnPropertyDescriptor(value, "runtimeConfiguration");
  const reference = descriptor === undefined
    ? undefined
    : snapshotRuntimeConfigurationReference("value" in descriptor ? descriptor.value : undefined);
  const decoded = getConversationRunProjectionSchema().parse(value);
  return Object.freeze({
    ...getManagedBrokerRunSnapshotSchema().parse({
      ...decoded,
      canonicalRunId: value.canonicalRunId,
    }),
    ...(reference ? { runtimeConfiguration: reference } : {}),
  });
}

function requireActivePersistenceRun(run: ManagedBrokerRunSnapshot): void {
  if (run.status !== "pending" && run.status !== "running" && run.status !== "waiting_for_tool") {
    throw new TypeError("Managed broker persistence requires an active run");
  }
}

function requireCanonicalWriterScope(
  scope: { projectId: string } | undefined,
  canonicalRunId: string | undefined,
  message: string,
): void {
  if (scope && !canonicalRunId) throw new TypeError(message);
}

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
  canonicalRunId: string;
  dispatch(state: ConversationHostedTerminalStateInput): Promise<HostedLifecycleTerminalState>;
}>();

/** Bind API completion credentials and transport privately to one canonical run. */
export function createManagedBrokerTerminal(input: {
  apiUrl: string;
  completionAuthToken: string;
  terminalAuthToken: string;
  /** Trusted negotiated lifecycle owner; defaults to runtime-owned standalone execution. */
  terminalOwner?: "runtime" | "api";
  run: ConversationRunProjection | ManagedBrokerRunSnapshot;
  modelId: string;
  resolveProvider(modelId: string): string;
  fetch?: typeof globalThis.fetch;
}): ManagedBrokerTerminal {
  const run = readManagedBrokerRunSnapshot(input.run);
  const terminalOwner = input.terminalOwner ?? "runtime";
  if (terminalOwner !== "runtime" && terminalOwner !== "api") {
    throw new TypeError("Invalid terminal owner");
  }
  if (typeof input.completionAuthToken !== "string" || !input.completionAuthToken.trim()) {
    throw new TypeError("Managed broker requires completion authorization");
  }
  const { apiUrl, completionAuthToken, terminalAuthToken, fetch: transport } = input;
  const routing = terminalRoute(terminalAuthToken, run.runId);
  if (run.canonicalRunId && routing.id.toLowerCase() !== run.canonicalRunId.toLowerCase()) {
    throw new TypeError("Managed broker admission and terminal routing do not match");
  }
  const resolveProvider = input.resolveProvider;
  const adapter = createConversationHostedTerminalAdapter({
    apiUrl: input.apiUrl,
    authToken: input.completionAuthToken,
    run: terminalOwner === "api" ? null : run,
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
  terminalStates.set(terminal, {
    runId: run.runId,
    canonicalRunId: routing.id,
    dispatch: adapter.dispatch,
  });
  return terminal;
}

/** Create exact-run API persistence callbacks while retaining credentials in the broker. */
export function createManagedBrokerPersistence(input: {
  apiUrl: string;
  runEventToken: string;
  /** Application authority accepted by the API completion route, never the append token. */
  completionAuthToken: string;
  terminalAuthToken: string;
  /** Trusted negotiated lifecycle owner; defaults to runtime-owned standalone execution. */
  terminalOwner?: "runtime" | "api";
  run: ConversationRunProjection | ManagedBrokerRunSnapshot;
  modelId: string;
  resolveProvider(modelId: string): string;
  fetch?: typeof globalThis.fetch;
  /** Internal/test persistence deadline; production uses the sink default. */
  eventPersistenceTimeoutMs?: number;
  /** Trusted migration opt-in. Requires API support and a project-bound generation writer. */
  toolCallAdmissions?: { projectId: string };
  /** Trusted migration opt-in. Disabled until the API accepts runtime_observations. */
  runtimeObservations?: { projectId: string };
}) {
  const run = readManagedBrokerRunSnapshot(input.run);
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
    ...(input.eventPersistenceTimeoutMs !== undefined
      ? { eventPersistenceTimeoutMs: input.eventPersistenceTimeoutMs }
      : {}),
    ...(input.toolCallAdmissions ? { toolCallAdmissions: input.toolCallAdmissions } : {}),
    ...(input.runtimeObservations ? { runtimeObservations: input.runtimeObservations } : {}),
  });
}

/** Create exact-run persistence from opaque broker authority with pinned API transport. */
export function createManagedBrokerPersistenceFromCapability(input: {
  capability: HostedRunEventWriterCapability;
  run: ConversationRunProjection | ManagedBrokerRunSnapshot;
  terminal: ManagedBrokerTerminal;
  /** Internal/test persistence deadline; production uses the sink default. */
  eventPersistenceTimeoutMs?: number;
  toolCallAdmissions?: { projectId: string };
  runtimeObservations?: { projectId: string };
}) {
  const run = readManagedBrokerRunSnapshot(input.run);
  requireActivePersistenceRun(run);
  const terminalState = terminalStates.get(input.terminal);
  if (
    terminalState?.runId !== run.runId ||
    (run.canonicalRunId &&
      terminalState.canonicalRunId.toLowerCase() !== run.canonicalRunId.toLowerCase())
  ) {
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
  if (
    run.canonicalRunId && canonicalRunId?.toLowerCase() !== run.canonicalRunId.toLowerCase()
  ) throw new TypeError("Managed broker admission and append routing do not match");
  requireCanonicalWriterScope(
    admissionScope,
    canonicalRunId,
    "Tool-call admissions require an exact canonical run writer",
  );
  requireCanonicalWriterScope(
    runtimeObservationScope,
    canonicalRunId,
    "Runtime observations require an exact canonical run writer",
  );
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
  const durableSink = createDurableRunEventSink({
    mirror: durableMirror,
    ...(input.eventPersistenceTimeoutMs !== undefined
      ? { timeoutMs: input.eventPersistenceTimeoutMs }
      : {}),
  });
  const resultFence = runtimeObservationScope ? createManagedToolResultFence() : undefined;
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
        resultFence?.fail(error);
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
  if (resultFence) bindManagedToolResultFence(modelRunEventSink, resultFence);
  if (runtimeObservationScope) {
    bindRuntimeObservationWriterCapability(
      modelRunEventSink,
      createRuntimeObservationWriterCapability({
        scope: {
          runId: run.runId,
          canonicalRunId: canonicalRunId!,
          projectId: runtimeObservationScope.projectId,
        },
        assertActive: () => {
          const snapshot = durableMirror.getSnapshot();
          if (finished || snapshot.disabled) {
            throw new DurableRunEventPersistenceError(
              "Model call capture scope is no longer active",
            );
          }
        },
      }),
    );
  }
  const output: ManagedBrokerOutput = {
    write(chunk) {
      if (finished) return Promise.reject(new TypeError("Managed broker output is finished"));
      return queue(async () => {
        await durableMirror.handleChunk(chunk);
        await flush();
        resultFence?.resultPersisted(chunk);
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
        resultFence?.fail(
          new DurableRunEventPersistenceError(
            "Managed output finished before the required tool result was persisted",
          ),
        );
      }, true);
    },
  };
  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;
    resultFence?.fail(new DurableRunEventPersistenceError("Managed result owner closed"));
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
    ...(run.runtimeConfiguration ? { runtimeConfiguration: run.runtimeConfiguration } : {}),
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
