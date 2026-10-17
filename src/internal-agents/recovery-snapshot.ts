import { readAttachedProviderMetadata } from "#veryfront/agent/runtime/provider-metadata.ts";
import { isDeepStrictEqual } from "node:util";
import { recoveryHistoryMessageDigest } from "./recovery-history.ts";
import { getAgentPauseCheckpointSchema } from "#veryfront/agent/runtime/manual-pause.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  getMessageSchema,
  getToolResultPartSchema,
} from "#veryfront/agent/schemas/agent.schema.ts";
import {
  getExecutorProviderReplayCheckpointSchema,
  getExecutorToolExposureCheckpointSchema,
} from "#veryfront/agent/hosted/executor-persistence-schema.ts";
import {
  applyProviderReplayCheckpointsToMessages,
  parseServerResolvedProviderReplayCheckpoints,
} from "#veryfront/agent/runtime/provider-replay.ts";
import { getToolCallAdmissionReceiptSchema } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { getRecoveryAdmissionSchema } from "./recovery-admission-schema.ts";
import { snapshotDurableValue } from "./durable-run-home-schema.ts";

const getSnapshotBindingSchema = defineSchema(() =>
  getRecoveryAdmissionSchema().pick({ identity: true, generation: true, sourceBinding: true })
    .strict()
);
const getToolBoundaryBaseSchema = defineSchema((v) =>
  v.object({
    modelMessageId: v.string().min(1).max(256),
    toolName: v.string().min(1).max(256),
    admissionReceipt: getToolCallAdmissionReceiptSchema(),
    input: getJsonValueSchema(),
  }).strict()
);
const getToolBoundarySchema = defineSchema((v) =>
  v.discriminatedUnion("kind", [
    getToolBoundaryBaseSchema().extend({ kind: v.literal("admitted-intent") }).strict(),
    getToolBoundaryBaseSchema().extend({
      kind: v.literal("acknowledged-receipt"),
      result: getToolResultPartSchema().extend({ result: getJsonValueSchema() }).strict(),
      resultEventId: v.string().min(1).max(256),
      acknowledgedExternalSequence: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    }).strict(),
  ])
);
export const getRecoveryModelTurnSchema = defineSchema((v) =>
  v.object({
    messageId: v.string().min(1).max(256),
    acknowledgedExternalSequence: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    providerReplayCheckpoint: getExecutorProviderReplayCheckpointSchema().optional(),
  }).strict()
);
const getRecoveryMessageSchema = defineSchema(() =>
  getMessageSchema().omit({ metadata: true }).strict()
);
export const getRecoveryContinuationSchema = defineSchema((v) =>
  getAgentPauseCheckpointSchema().extend({
    messages: v.array(getRecoveryMessageSchema()).max(1_000),
  })
);
export const getRecoverySnapshotSchema = defineSchema((v) =>
  v.object({
    version: v.literal(1),
    runtimeContinuation: getRecoveryContinuationSchema().optional(),
    initialHistoryMessageIds: v.array(v.string().min(1).max(256)).max(1000).optional(),
    initialHistoryMessageDigests: v.array(v.string().regex(/^[0-9a-f]{64}$/)).max(1000).optional(),
    binding: getSnapshotBindingSchema(),
    acknowledgedEventId: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    acknowledgedExternalSequence: v.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    // Runtime credentials and enumerable private metadata are not checkpoint fields.
    messages: v.array(getRecoveryMessageSchema()).max(1_000),
    modelTurns: v.array(getRecoveryModelTurnSchema()).max(100),
    toolExposureCheckpoint: getExecutorToolExposureCheckpointSchema(),
    toolBoundaries: v.array(getToolBoundarySchema()).max(1_000),
  }).strict()
);
export type RecoverySnapshot = InferSchema<ReturnType<typeof getRecoverySnapshotSchema>>;
export type RecoverySnapshotBinding = RecoverySnapshot["binding"];
const invalid = () => new Error("Recovery snapshot is inconsistent or unsafe to restore");

/** Data validation only. Disk records, admission receipts and annotations cannot authorize effects. */
export function parseRecoverySnapshot(value: unknown): RecoverySnapshot {
  const snapshot = getRecoverySnapshotSchema().parse(snapshotDurableValue(value));
  const { identity } = snapshot.binding;
  if (snapshot.binding.sourceBinding.projectId !== identity.projectId) throw invalid();
  if (
    new Set(snapshot.toolExposureCheckpoint.loadedToolNames).size !==
      snapshot.toolExposureCheckpoint.loadedToolNames.length
  ) throw invalid();
  if (
    snapshot.runtimeContinuation?.toolExposureCheckpoint &&
    !isDeepStrictEqual(
      snapshot.runtimeContinuation.toolExposureCheckpoint,
      snapshot.toolExposureCheckpoint,
    )
  ) throw invalid();
  const messages = new Map(snapshot.messages.map((message) => [message.id, message]));
  if (messages.size !== snapshot.messages.length) throw invalid();
  const historyIds = new Set(snapshot.initialHistoryMessageIds ?? []);
  if (
    historyIds.size !== (snapshot.initialHistoryMessageIds?.length ?? 0) ||
    (snapshot.initialHistoryMessageDigests?.length ?? 0) !== historyIds.size ||
    (snapshot.initialHistoryMessageIds ?? []).some((id, index) =>
      snapshot.messages[index]?.id !== id ||
      recoveryHistoryMessageDigest(snapshot.messages[index]!) !==
        snapshot.initialHistoryMessageDigests?.[index]
    )
  ) throw invalid();
  if (
    snapshot.runtimeContinuation &&
    !isDeepStrictEqual(
      snapshot.runtimeContinuation.messages.map(({ id, role, parts }) => ({ id, role, parts })),
      snapshot.messages.map(({ id, role, parts }) => ({ id, role, parts })),
    )
  ) throw invalid();
  const turnIds = new Set<string>();
  const turnSequences = new Map<string, number>();
  const replay = [];
  let priorSequence = 0;
  for (const turn of snapshot.modelTurns) {
    if (
      turnIds.has(turn.messageId) || messages.get(turn.messageId)?.role !== "assistant" ||
      turn.acknowledgedExternalSequence > snapshot.acknowledgedExternalSequence ||
      turn.acknowledgedExternalSequence < priorSequence ||
      turn.providerReplayCheckpoint && turn.providerReplayCheckpoint.messageId !== turn.messageId
    ) throw invalid();
    turnIds.add(turn.messageId);
    turnSequences.set(turn.messageId, turn.acknowledgedExternalSequence);
    priorSequence = turn.acknowledgedExternalSequence;
    if (turn.providerReplayCheckpoint) replay.push(turn.providerReplayCheckpoint);
  }
  const parsedReplay = parseServerResolvedProviderReplayCheckpoints(replay);
  if (snapshot.runtimeContinuation?.providerMetadata?.length) {
    applyProviderReplayCheckpointsToMessages(snapshot.messages, parsedReplay);
    const metadataIds = new Set<string>();
    for (const entry of snapshot.runtimeContinuation.providerMetadata) {
      const message = messages.get(entry.messageId);
      const expected = message && readAttachedProviderMetadata(message);
      if (
        metadataIds.has(entry.messageId) || expected === undefined ||
        !isDeepStrictEqual(entry.metadata, expected)
      ) throw invalid();
      metadataIds.add(entry.messageId);
    }
  }
  if (
    snapshot.messages.some((message) =>
      message.role === "assistant" && !historyIds.has(message.id) && !turnIds.has(message.id)
    )
  ) throw invalid();
  const calls = new Map<string, { messageId: string; toolName: string; input: unknown }>();
  const results = new Map<string, unknown>();
  const providerCalls = new Set<string>();
  const providerResults = new Map<string, string>();
  for (const message of snapshot.messages) {
    for (const part of message.parts) {
      if (!("toolCallId" in part) || !("toolName" in part)) continue;
      if (part.type === "tool-result") {
        if (results.has(part.toolCallId)) throw invalid();
        results.set(part.toolCallId, part);
        if ("providerExecuted" in part && part.providerExecuted === true) {
          providerResults.set(part.toolCallId, part.toolName);
        }
      } else if ("args" in part || "input" in part) {
        if (message.role !== "assistant" || calls.has(part.toolCallId)) throw invalid();
        if ("providerExecuted" in part && part.providerExecuted === true) {
          if (
            !historyIds.has(message.id) &&
            !snapshot.modelTurns.some((turn) =>
              turn.messageId === message.id && turn.providerReplayCheckpoint
            )
          ) throw invalid();
          providerCalls.add(part.toolCallId);
        }
        calls.set(part.toolCallId, {
          messageId: message.id,
          toolName: part.toolName,
          input: "args" in part ? part.args : part.input,
        });
      }
    }
  }
  for (const [id, call] of calls) {
    if (!historyIds.has(call.messageId)) continue;
    const resultMessage = snapshot.messages.find((message) =>
      historyIds.has(message.id) &&
      (message.role === "tool" || providerCalls.has(id) && message.role === "assistant") &&
      message.parts.some((part) =>
        part.type === "tool-result" && part.toolCallId === id && part.toolName === call.toolName
      )
    );
    if (!resultMessage || !results.has(id)) throw invalid();
    calls.delete(id);
    results.delete(id);
    providerCalls.delete(id);
    providerResults.delete(id);
  }
  if (providerCalls.size || providerResults.size) {
    // Reuse the runtime's exact provider-block/transcript correlation before
    // excluding provider-owned effects from local dispatch admission coverage.
    applyProviderReplayCheckpointsToMessages(
      snapshot.messages,
      parseServerResolvedProviderReplayCheckpoints(replay),
    );
    for (const id of providerCalls) {
      const call = calls.get(id);
      if (!call || providerResults.get(id) !== call.toolName) throw invalid();
      calls.delete(id);
      results.delete(id);
      providerResults.delete(id);
    }
    if (providerResults.size) throw invalid();
  }
  const coveredCalls = new Set<string>();
  const occurrences = new Set<string>();
  const acknowledgedEventIds = new Set<string>();
  const publicToolCallIds = new Set<string>();
  for (const boundary of snapshot.toolBoundaries) {
    const receipt = boundary.admissionReceipt;
    if (
      occurrences.has(receipt.occurrenceId) || receipt.projectId !== identity.projectId ||
      receipt.runId !== identity.canonicalRunId || !turnIds.has(boundary.modelMessageId) ||
      publicToolCallIds.has(receipt.publicToolCallId) ||
      receipt.startEventId === receipt.admissionEventId ||
      acknowledgedEventIds.has(receipt.startEventId) ||
      acknowledgedEventIds.has(receipt.admissionEventId)
    ) throw invalid();
    occurrences.add(receipt.occurrenceId);
    publicToolCallIds.add(receipt.publicToolCallId);
    acknowledgedEventIds.add(receipt.startEventId);
    acknowledgedEventIds.add(receipt.admissionEventId);
    const call = calls.get(receipt.toolCallId);
    if (
      !call || call.messageId !== boundary.modelMessageId || call.toolName !== boundary.toolName ||
      !isDeepStrictEqual(call.input, boundary.input) ||
      coveredCalls.has(receipt.toolCallId)
    ) throw invalid();
    coveredCalls.add(receipt.toolCallId);
    if (boundary.kind === "acknowledged-receipt") {
      if (
        boundary.result.toolCallId !== receipt.toolCallId ||
        boundary.result.toolName !== boundary.toolName ||
        acknowledgedEventIds.has(boundary.resultEventId) ||
        boundary.resultEventId === receipt.admissionEventId ||
        boundary.resultEventId === receipt.startEventId ||
        boundary.acknowledgedExternalSequence <=
          (turnSequences.get(boundary.modelMessageId) ?? 0) ||
        boundary.acknowledgedExternalSequence > snapshot.acknowledgedExternalSequence ||
        !isDeepStrictEqual(results.get(receipt.toolCallId), boundary.result)
      ) throw invalid();
      acknowledgedEventIds.add(boundary.resultEventId);
      results.delete(receipt.toolCallId);
    }
  }
  if (coveredCalls.size !== calls.size || results.size !== 0) throw invalid();
  return snapshot;
}

/** Fail closed until an unresolved intent has a separately verified durable effect receipt. */
export function validateRecoverySnapshotForRestore(
  value: unknown,
  expectedBinding: RecoverySnapshotBinding,
): RecoverySnapshot {
  const snapshot = parseRecoverySnapshot(value);
  const expected = getSnapshotBindingSchema().parse(expectedBinding);
  if (!isDeepStrictEqual(snapshot.binding, expected)) throw invalid();
  if (snapshot.toolBoundaries.some((boundary) => boundary.kind === "admitted-intent")) {
    throw invalid();
  }
  const replay = snapshot.modelTurns.flatMap((turn) =>
    turn.providerReplayCheckpoint ? [turn.providerReplayCheckpoint] : []
  );
  // Existing runtime checks reconstructibility and exact transcript/provider continuity.
  applyProviderReplayCheckpointsToMessages(
    snapshot.messages,
    parseServerResolvedProviderReplayCheckpoints(replay),
  );
  return snapshot;
}
