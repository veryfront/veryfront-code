import {
  getRecoveryCheckpointSidecarSchema,
  MAX_RECOVERY_CHECKPOINT_BYTES,
  type RecoveryCheckpointAcknowledgement,
  type RecoveryCheckpointSidecar,
} from "./recovery-checkpoint-contract.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { recoveryHistoryMessageDigest } from "./recovery-history.ts";
import type { AgentRunEvent } from "#veryfront/runtime/model-call-context.ts";
import type { AgentRunModelCallCaptureReceipt } from "#veryfront/runtime/model-call-capture-receipt.ts";
import { join } from "node:path";
import type { AgentRuntimeRecoveryBoundary } from "#veryfront/agent/runtime/index.ts";
import { coerceWireEvent } from "#veryfront/agent/ag-ui/sse-parser.ts";
import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";
import { createToolExposureCheckpointEvent } from "#veryfront/agent/runtime/tool-exposure.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { getCurrentToolCallOccurrenceIdentity } from "#veryfront/runtime/tool-call-occurrence.ts";
import {
  type AdmitExecutorToolCall,
  runWithToolCallAdmissionReceipt,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import type { RecoveryToolExecutionPolicy } from "#veryfront/runtime/execution-ownership-guard.ts";
import { snapshotDurableValue } from "./durable-run-home-schema.ts";
import { DurableRunHome } from "./durable-run-home.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import type { RecoverySessionOwner } from "./recovery-session-owner.ts";
import {
  getRecoveryContinuationSchema,
  parseRecoverySnapshot,
  type RecoverySnapshot,
} from "./recovery-snapshot.ts";

/** Original authenticated append result; event IDs must be the accepted/replayed rows. */
export type RecoveryEventAppend = (
  event: Record<string, unknown>,
  occurrenceId?: string,
  recoveryCheckpoint?: RecoveryCheckpointSidecar,
) => Promise<{
  eventId: number;
  externalSequence: number;
  toolAdmissions: AgentRunToolCallAdmissionReceipt[];
  modelCaptures?: AgentRunModelCallCaptureReceipt[];
  recoveryCheckpoint?: RecoveryCheckpointAcknowledgement;
}>;
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

function recoveryMessages(messages: AgentRuntimeRecoveryBoundary["messages"]) {
  return messages.map(({ metadata: _metadata, ...message }) => message);
}

/** Private host materialization; API event acknowledgement never proves external effect commit. */
export async function createManagedRecoveryWriter(input: {
  claims: VerifiedControlPlaneRequestClaims;
  owner: RecoverySessionOwner;
  directory: string;
  append: RecoveryEventAppend;
  bindAdmissionWriter: (callback: AdmitExecutorToolCall) => void;
  restoredSnapshot?: RecoverySnapshot;
}) {
  const admission = getVerifiedControlPlaneRecoveryAdmission(input.claims);
  if (!admission) throw new Error("Recovery writer lacks original verified dispatch");
  input.owner.assertAdmittedClaims(input.claims);
  const home = await DurableRunHome.open({
    directory: join(input.directory, `${admission.identity.canonicalRunId}.snapshot`),
    identity: admission.identity,
  });
  let diskSequence = (await home.read()).length;
  let initialBoundary = true;
  let externalSequence = admission.acknowledgedExternalSequence;
  let appendTail = Promise.resolve();
  let boundaryTail = Promise.resolve();
  let failure: { error: unknown } | undefined;
  let lastRuntimeContinuation = input.restoredSnapshot?.runtimeContinuation;
  let initialHistoryMessageIds = input.restoredSnapshot?.initialHistoryMessageIds;
  let initialHistoryMessageDigests = input.restoredSnapshot?.initialHistoryMessageDigests;
  const historicalToolCallIds = new Set<string>();
  for (const message of input.restoredSnapshot?.messages ?? []) {
    if (!initialHistoryMessageIds?.includes(message.id)) continue;
    for (const part of message.parts) {
      if ("toolCallId" in part) historicalToolCallIds.add(part.toolCallId);
    }
  }
  let signal: AbortSignal | undefined;
  const admissions = new Map<string, Deferred<AgentRunToolCallAdmissionReceipt>>();
  const results = new Map<string, Deferred<{ eventId: number; externalSequence: number }>>();
  const fail = (error: unknown) => {
    failure ??= { error };
    for (const pending of admissions.values()) pending.reject(failure.error);
    for (const pending of results.values()) pending.reject(failure.error);
  };
  const assertNotFailed = () => {
    if (failure) throw failure.error;
  };
  const modelTurns = new Map<string, unknown>(
    (input.restoredSnapshot?.modelTurns ?? []).map((turn) => [turn.messageId, turn]),
  );
  const restoredBoundaries = new Map(
    (input.restoredSnapshot?.toolBoundaries ?? []).map((
      boundary,
    ) => [boundary.admissionReceipt.toolCallId, boundary]),
  );
  const admissionFor = (id: string) => {
    let value = admissions.get(id);
    if (!value) {
      value = deferred();
      admissions.set(id, value);
    }
    return value;
  };
  const resultFor = (id: string) => {
    let value = results.get(id);
    if (!value) {
      value = deferred();
      results.set(id, value);
    }
    return value;
  };
  const active = async () => {
    assertNotFailed();
    signal?.throwIfAborted();
    await input.owner.assertCurrentOwnership();
    assertNotFailed();
    signal?.throwIfAborted();
  };
  const append = (
    event: Record<string, unknown>,
    occurrenceId?: string,
    recoveryCheckpoint?: RecoveryCheckpointSidecar,
  ) => {
    const operation = appendTail.then(async () => {
      await active();
      if (
        recoveryCheckpoint &&
        new TextEncoder().encode(privateJsonStringify(recoveryCheckpoint)).byteLength >
          MAX_RECOVERY_CHECKPOINT_BYTES
      ) {
        throw new Error("Recovery safe boundary exceeds its bound");
      }
      const receipt = await input.append(event, occurrenceId, recoveryCheckpoint);
      if (
        recoveryCheckpoint && (
          !receipt.recoveryCheckpoint ||
          receipt.recoveryCheckpoint.snapshot_event_id !== receipt.eventId ||
          receipt.recoveryCheckpoint.snapshot_external_sequence !== receipt.externalSequence ||
          !Number.isSafeInteger(receipt.recoveryCheckpoint.checkpoint_event_id) ||
          receipt.recoveryCheckpoint.checkpoint_event_id <= receipt.eventId
        )
      ) throw new Error("Recovery safe boundary lacks its actual committed fact acknowledgement");
      await active();
      if (
        !Number.isSafeInteger(receipt.eventId) || receipt.eventId < 1 ||
        !Number.isSafeInteger(receipt.externalSequence) ||
        receipt.externalSequence < externalSequence
      ) {
        throw new Error("Recovery event append receipt is inconsistent");
      }
      externalSequence = receipt.externalSequence;
      return receipt;
    });
    appendTail = operation.then(() => {}, (error) => {
      fail(error);
      throw error;
    });
    void appendTail.catch(() => {});
    return operation;
  };
  const wait = async <T>(value: Promise<T>): Promise<T> => {
    assertNotFailed();
    if (!signal) throw new Error("Recovery writer lifetime is not bound");
    signal.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal!.reason);
      signal!.addEventListener("abort", abort, { once: true });
      value.then(resolve, reject).finally(() => signal!.removeEventListener("abort", abort));
    });
  };
  const admitToolCall: AdmitExecutorToolCall = async (call, callSignal) => {
    callSignal.throwIfAborted();
    const receipt = await wait(admissionFor(call.toolCallId).promise);
    callSignal.throwIfAborted();
    await active();
    if (
      receipt.occurrenceId !== call.occurrenceId || receipt.toolCallId !== call.toolCallId ||
      receipt.projectId !== admission.identity.projectId ||
      receipt.runId !== admission.identity.canonicalRunId
    ) {
      throw new Error("Recovery delegated tool admission is foreign");
    }
    return receipt;
  };
  input.bindAdmissionWriter(admitToolCall);
  const executeTool: RecoveryToolExecutionPolicy = async (_execution, operation) => {
    const occurrence = getCurrentToolCallOccurrenceIdentity();
    if (!occurrence) throw new Error("Recovery tool lacks its original occurrence");
    const receipt = await wait(admissionFor(occurrence.toolCallId).promise);
    if (
      receipt.occurrenceId !== occurrence.occurrenceId ||
      receipt.toolCallId !== occurrence.toolCallId ||
      receipt.projectId !== admission.identity.projectId ||
      receipt.runId !== admission.identity.canonicalRunId
    ) {
      throw new Error("Recovery tool admission is foreign");
    }
    // The canonical intent boundary is written by the runtime before dispatch.
    await boundaryTail;
    await active();
    return await runWithToolCallAdmissionReceipt(
      receipt,
      () => {
        assertNotFailed();
        signal?.throwIfAborted();
      },
      operation,
      admitToolCall,
    );
  };
  return Object.freeze({
    bindSignal(value: AbortSignal) {
      if (signal) throw new Error("Recovery writer lifetime already bound");
      signal = value;
      if (value.aborted) fail(value.reason);
      else value.addEventListener("abort", () => fail(value.reason), { once: true });
    },
    executeTool,
    async persistProviderReplayCheckpoint(checkpoint: ProviderReplayCheckpoint) {
      await append(createProviderReplayCheckpointEvent(checkpoint));
    },
    async persistRunEvent(event: AgentRunEvent) {
      try {
        const receipt = await append(event);
        if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
        const capture = receipt.modelCaptures?.find((value) =>
          value.modelCallId === event.modelCallId
        );
        if (
          !capture || capture.projectId !== admission.identity.projectId ||
          capture.runId !== admission.identity.canonicalRunId ||
          capture.eventId !== String(receipt.eventId)
        ) {
          throw new Error("Recovery model context lacks its exact authenticated capture receipt");
        }
        return capture;
      } catch (error) {
        fail(error);
        throw error;
      }
    },
    async appendMappedEvent(
      mapped: { event: string; payload: Record<string, unknown> },
      occurrenceId?: string,
      observedToolResult = false,
    ) {
      try {
        const event = coerceWireEvent(mapped.event, mapped.payload);
        if (
          ["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR", "MODEL_CALL_COMPLETED"].includes(
            String(event.type),
          )
        ) return;
        if (
          event.type === "TOOL_CALL_START" && typeof event.toolCallId === "string" &&
          historicalToolCallIds.has(event.toolCallId)
        ) {
          const error = new Error("Current recovery tool collides with immutable incoming history");
          fail(error);
          throw error;
        }
        if (
          observedToolResult && (event.type !== "TOOL_CALL_START" || occurrenceId !== undefined)
        ) {
          throw new Error("Recovery observation cannot carry local tool admission");
        }
        const receipt = await append(event, occurrenceId);
        // Result-only provider observations carry no executable local occurrence.
        // Persist them without resolving an admission that could authorize a tool.
        if (event.type === "TOOL_CALL_START" && !observedToolResult) {
          if (!occurrenceId || receipt.toolAdmissions.length !== 1) {
            throw new Error("Recovery tool start lacks exact durable admission");
          }
          const tool = receipt.toolAdmissions[0]!;
          if (
            tool.occurrenceId !== occurrenceId || tool.toolCallId !== event.toolCallId ||
            tool.projectId !== admission.identity.projectId ||
            tool.runId !== admission.identity.canonicalRunId
          ) {
            throw new Error("Recovery tool start acknowledgement is foreign");
          }
          admissionFor(tool.toolCallId).resolve(tool);
        }
        if (event.type === "TOOL_CALL_RESULT" && typeof event.toolCallId === "string") {
          resultFor(event.toolCallId).resolve(receipt);
        }
      } catch (error) {
        fail(error);
        throw error;
      }
    },
    persistBoundary(boundary: AgentRuntimeRecoveryBoundary) {
      const operation = boundaryTail.then(async () => {
        await active();
        const messages = recoveryMessages(boundary.messages);
        if (!initialHistoryMessageIds) {
          initialHistoryMessageIds = messages.map((message) => message.id);
          initialHistoryMessageDigests = messages.map(recoveryHistoryMessageDigest);
          for (const message of messages) {
            for (const part of message.parts) {
              if ("toolCallId" in part) historicalToolCallIds.add(part.toolCallId);
            }
          }
        }
        const history = new Set(initialHistoryMessageIds);
        if (boundary.runtimeContinuation) {
          lastRuntimeContinuation = getRecoveryContinuationSchema().parse(
            snapshotDurableValue({
              ...boundary.runtimeContinuation,
              messages: recoveryMessages(boundary.runtimeContinuation.messages),
            }),
          );
        }
        const matchingContinuation = lastRuntimeContinuation?.messages.length === messages.length &&
            lastRuntimeContinuation.messages.every((message, index) =>
              recoveryHistoryMessageDigest(message) ===
                recoveryHistoryMessageDigest(messages[index]!)
            )
          ? lastRuntimeContinuation
          : undefined;
        const toolBoundaries: unknown[] = [];
        for (const message of messages) {
          if (message.role !== "assistant" || history.has(message.id)) continue;
          for (const part of message.parts) {
            if (
              !("toolCallId" in part) || !("toolName" in part) ||
              !("args" in part || "input" in part) ||
              ("providerExecuted" in part && part.providerExecuted === true)
            ) continue;
            const prior = restoredBoundaries.get(part.toolCallId);
            if (prior) {
              toolBoundaries.push(prior);
              continue;
            }
            const receipt = await wait(admissionFor(part.toolCallId).promise);
            const base = {
              modelMessageId: message.id,
              toolName: part.toolName,
              admissionReceipt: receipt,
              input: "args" in part ? part.args : part.input,
            };
            const result = messages.flatMap((candidate) => candidate.parts).find((candidate) =>
              candidate.type === "tool-result" && candidate.toolCallId === part.toolCallId
            );
            if (result?.type === "tool-result") {
              const acknowledged = await wait(resultFor(part.toolCallId).promise);
              toolBoundaries.push({
                ...base,
                kind: "acknowledged-receipt",
                result,
                resultEventId: String(acknowledged.eventId),
                acknowledgedExternalSequence: acknowledged.externalSequence,
              });
            } else {
              toolBoundaries.push({ ...base, kind: "admitted-intent" });
            }
          }
        }
        const pendingModelTurnMessageIds: string[] = [];
        const boundaryModelTurns: unknown[] = [
          ...modelTurns.values(),
        ];
        for (const message of messages) {
          if (
            message.role !== "assistant" || history.has(message.id) || modelTurns.has(message.id)
          ) continue;
          pendingModelTurnMessageIds.push(message.id);
          const providerReplayCheckpoint = boundary.providerReplayCheckpoints.find((value) =>
            value.messageId === message.id
          );
          boundaryModelTurns.push({
            messageId: message.id,
            ...(providerReplayCheckpoint ? { providerReplayCheckpoint } : {}),
          });
        }
        const safeBoundary = matchingContinuation &&
          !toolBoundaries.some((value) =>
            typeof value === "object" && value !== null && "kind" in value &&
            value.kind === "admitted-intent"
          );
        const checkpoint = safeBoundary
          ? getRecoveryCheckpointSidecarSchema().parse({
            snapshot_event_index: 0,
            pending_model_turn_message_ids: pendingModelTurnMessageIds,
            snapshot: {
              version: 1,
              binding: {
                identity: admission.identity,
                generation: admission.generation,
                sourceBinding: admission.sourceBinding,
              },
              runtimeContinuation: matchingContinuation,
              initialHistoryMessageIds,
              initialHistoryMessageDigests,
              messages,
              modelTurns: boundaryModelTurns,
              toolExposureCheckpoint: boundary.toolExposureCheckpoint,
              toolBoundaries,
            },
          })
          : undefined;
        // The first cursor must be committed with its native continuation. A
        // process may disappear after the API commit and before the local journal.
        const initialPublication = initialBoundary;
        if (initialPublication && !checkpoint) {
          throw new Error("Initial recovery publication lacks a native continuation");
        }
        const appendObservations = async () => {
          for (const checkpoint of boundary.providerReplayCheckpoints) {
            if (!history.has(checkpoint.messageId) && !modelTurns.has(checkpoint.messageId)) {
              await append(createProviderReplayCheckpointEvent(checkpoint));
            }
          }
          await append(createToolExposureCheckpointEvent(boundary.toolExposureCheckpoint));
        };
        if (!initialPublication) await appendObservations();
        const transcriptReceipt = await append(
          { type: "MESSAGES_SNAPSHOT", messages },
          undefined,
          checkpoint,
        );
        if (initialPublication) await appendObservations();
        for (const message of messages) {
          if (
            message.role !== "assistant" || history.has(message.id) || modelTurns.has(message.id)
          ) continue;
          const providerReplayCheckpoint = boundary.providerReplayCheckpoints.find((value) =>
            value.messageId === message.id
          );
          modelTurns.set(message.id, {
            messageId: message.id,
            acknowledgedExternalSequence: transcriptReceipt.externalSequence,
            ...(providerReplayCheckpoint ? { providerReplayCheckpoint } : {}),
          });
        }
        const snapshot = parseRecoverySnapshot(
          snapshotDurableValue({
            version: 1,
            binding: {
              identity: admission.identity,
              generation: admission.generation,
              sourceBinding: admission.sourceBinding,
            },
            acknowledgedEventId: transcriptReceipt.eventId,
            acknowledgedExternalSequence: transcriptReceipt.externalSequence,
            ...(matchingContinuation ? { runtimeContinuation: matchingContinuation } : {}),
            initialHistoryMessageIds,
            initialHistoryMessageDigests,
            messages,
            modelTurns: [...modelTurns.values()],
            toolExposureCheckpoint: boundary.toolExposureCheckpoint,
            toolBoundaries,
          }),
        );
        await active();
        // A retired predecessor can finish an already-started immutable append
        // after this owner read the journal. Only an admitted predecessor record
        // may occupy that slot; same-generation conflicts remain fatal.
        for (let retry = 0;; retry++) {
          await active();
          try {
            await home.append({ sequence: diskSequence + 1, value: snapshot });
            await active();
            diskSequence++;
            initialBoundary = false;
            break;
          } catch (error) {
            await active();
            const records = await home.read();
            const occupied = records[diskSequence];
            if (!occupied || retry >= 255) throw error;
            const predecessor = await input.owner.validatePredecessorSnapshot(occupied.value);
            if (
              privateJsonStringify(predecessor.binding.generation) ===
                privateJsonStringify(admission.generation)
            ) throw error;
            await active();
            diskSequence++;
          }
        }
      });
      boundaryTail = operation.catch((error) => {
        fail(error);
        throw error;
      });
      void boundaryTail.catch(() => {});
      return operation;
    },
  });
}
export type ManagedRecoveryWriter = Awaited<ReturnType<typeof createManagedRecoveryWriter>>;
