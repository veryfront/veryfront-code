import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  getRecoveryGenerationSchema,
  getRecoverySourceBindingSchema,
} from "./recovery-admission-schema.ts";

export const MAX_RECOVERY_SUFFIX_ROWS = 100;
export const MAX_RECOVERY_SUFFIX_PAGE_BYTES = 256 * 1024;
export const MAX_RECOVERY_SUFFIX_PAGES = 32;
export const MAX_RECOVERY_SUFFIX_BYTES = 8 * 1024 * 1024;

/** Private paired-credential reader contract; public event projections are insufficient. */
export const getRecoverySuffixPageSchema = defineSchema((v) => {
  const eventId = v.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
  const cursor = v.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
  const hash = v.string().regex(/^[0-9a-f]{64}$/);
  return v.object({
    version: v.literal(1),
    identity: v.object({
      projectId: v.string().uuid(),
      canonicalRunId: v.string().uuid(),
      publicRunId: v.string().min(1).max(256),
      agentId: v.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
      threadId: v.string().uuid(),
    }).strict(),
    generation: getRecoveryGenerationSchema(),
    leaseRemainingMs: v.number().int().min(1).max(300_000),
    source: v.object({
      sourceHash: hash,
      sourceBinding: getRecoverySourceBindingSchema(),
    }).strict(),
    target: v.object({
      acknowledgedEventId: cursor,
      acknowledgedExternalSequence: cursor,
    }).strict(),
    continuations: v.array(
      v.object({
        checkpointEventId: eventId,
        payloadHash: hash,
        fact: v.object({
          type: v.literal("AGENT_RUN_MANAGED_RECOVERY_CONTINUATION_SEALED"),
          version: v.literal(1),
          dispatchFactEventId: eventId,
          generation: getRecoveryGenerationSchema(),
          source: v.object({ sourceHash: hash, sourceBinding: getRecoverySourceBindingSchema() })
            .strict(),
          snapshotEventId: eventId,
          snapshotExternalSequence: eventId,
          snapshot: getRecoverySnapshotSchema(),
        }).strict(),
      }).strict(),
    ).max(100),
    events: v.array(
      v.object({
        eventId,
        externalSequence: eventId.nullable(),
        eventType: v.string().min(1).max(128),
        payload: getJsonValueSchema(),
        appendGeneration: getRecoveryGenerationSchema(),
        dispatchFactEventId: eventId,
        payloadHash: hash,
      }).strict(),
    ).max(MAX_RECOVERY_SUFFIX_ROWS),
    nextAfterEventId: eventId.nullable(),
  }).strict();
});
export type RecoverySuffixPage = InferSchema<ReturnType<typeof getRecoverySuffixPageSchema>>;

import { createHash } from "node:crypto";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import {
  getRecoverySnapshotSchema,
  parseRecoverySnapshot,
  type RecoverySnapshot,
} from "./recovery-snapshot.ts";
import type { RecoveryOwnershipReceipt } from "./recovery-admission-schema.ts";

const monotonicNow = performance.now.bind(performance);
const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);
const ownKeys = Object.keys.bind(Object);
const isArray = Array.isArray.bind(Array);
const authenticatedSuffixes = createPrivateWeakStore<
  object,
  { snapshot: string; suffix: string }
>();
const invalidSuffix = () => new Error("Managed recovery suffix is incomplete or untrusted");

/** The API hashes decoded persisted JSON, preserving array order and sorting object keys. */
export function recoverySuffixPayloadHash(payload: unknown): string {
  const value = getJsonValueSchema().parse(payload);
  function canonical(input: typeof value): string {
    if (input === null || typeof input !== "object") return privateJsonStringify(input);
    if (isArray(input)) {
      let result = "[";
      for (let index = 0; index < input.length; index++) {
        result += `${index === 0 ? "" : ","}${canonical(input[index]!)}`;
      }
      return `${result}]`;
    }
    const keys = ownKeys(input);
    for (let index = 1; index < keys.length; index++) {
      let current = index;
      while (current > 0 && keys[current - 1]! > keys[current]!) {
        const previous = keys[current - 1]!;
        keys[current - 1] = keys[current]!;
        keys[current] = previous;
        current--;
      }
    }
    let result = "{";
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      result += `${index === 0 ? "" : ","}${privateJsonStringify(key)}:${canonical(input[key]!)}`;
    }
    return `${result}}`;
  }
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

/**
 * Reads only authenticated, bounded raw suffix pages. It never derives continuation
 * state from transcript length, a tool result, or a global database cursor.
 */
export async function readAuthenticatedRecoverySuffix(input: {
  snapshot: RecoverySnapshot;
  claims: VerifiedControlPlaneRequestClaims;
  readPage: (request: {
    afterEventId: number;
    throughEventId: number;
    throughExternalSequence: number;
    limit: number;
  }) => Promise<unknown>;
  assertCurrentOwnership: () => Promise<RecoveryOwnershipReceipt>;
}): Promise<
  {
    events: RecoverySuffixPage["events"];
    continuations: RecoverySuffixPage["continuations"];
    target: RecoverySuffixPage["target"];
  }
> {
  const admission = getVerifiedControlPlaneRecoveryAdmission(input.claims);
  if (!admission) throw invalidSuffix();
  const snapshot = parseRecoverySnapshot(input.snapshot);
  const initialStarted = monotonicNow();
  const target = await input.assertCurrentOwnership();
  const deadline = Math.min(initialStarted + target.leaseRemainingMs, initialStarted + 10_000);
  const same = (left: unknown, right: unknown) =>
    privateJsonStringify(left) === privateJsonStringify(right);
  if (
    target.identity.projectId !== admission.identity.projectId ||
    target.identity.canonicalRunId !== admission.identity.canonicalRunId ||
    target.identity.publicRunId !== admission.identity.publicRunId ||
    target.identity.agentId !== admission.identity.agentId ||
    target.identity.threadId !== admission.identity.threadId ||
    !same(target.generation, admission.generation) ||
    !same(snapshot.binding.identity, admission.identity) ||
    !same(snapshot.binding.sourceBinding, admission.sourceBinding) ||
    snapshot.acknowledgedEventId > target.acknowledgedEventId ||
    snapshot.acknowledgedExternalSequence > target.acknowledgedExternalSequence
  ) throw invalidSuffix();
  let afterEventId = snapshot.acknowledgedEventId;
  let externalSequence = snapshot.acknowledgedExternalSequence;
  let totalBytes = 0;
  const events: RecoverySuffixPage["events"] = [];
  const continuations: RecoverySuffixPage["continuations"] = [];
  for (let pageIndex = 0; pageIndex < MAX_RECOVERY_SUFFIX_PAGES; pageIndex++) {
    if (monotonicNow() >= deadline) throw invalidSuffix();
    const pageStarted = monotonicNow();
    const raw = await input.readPage({
      afterEventId,
      throughEventId: target.acknowledgedEventId,
      throughExternalSequence: target.acknowledgedExternalSequence,
      limit: MAX_RECOVERY_SUFFIX_ROWS,
    });
    const bytes = encode(privateJsonStringify(raw)).byteLength;
    totalBytes += bytes;
    if (bytes > MAX_RECOVERY_SUFFIX_PAGE_BYTES || totalBytes > MAX_RECOVERY_SUFFIX_BYTES) {
      throw invalidSuffix();
    }
    const page = getRecoverySuffixPageSchema().parse(raw);
    if (
      monotonicNow() >= Math.min(deadline, pageStarted + page.leaseRemainingMs) ||
      !same(page.identity, target.identity) || !same(page.generation, admission.generation) ||
      !same(page.source.sourceBinding, admission.sourceBinding) ||
      page.source.sourceHash !== admission.identity.sourceHash ||
      page.target.acknowledgedEventId !== target.acknowledgedEventId ||
      page.target.acknowledgedExternalSequence !== target.acknowledgedExternalSequence
    ) throw invalidSuffix();
    let lastEventId = afterEventId;
    for (const event of page.events) {
      if (
        event.eventId <= lastEventId || event.eventId > target.acknowledgedEventId ||
        event.dispatchFactEventId >= event.eventId ||
        !same(event.appendGeneration, snapshot.binding.generation) ||
        event.payloadHash !== recoverySuffixPayloadHash(event.payload)
      ) throw invalidSuffix();
      lastEventId = event.eventId;
      if (event.externalSequence !== null && event.externalSequence !== ++externalSequence) {
        throw invalidSuffix();
      }
      events.push(event);
    }
    let lastCheckpointId = afterEventId;
    for (const continuation of page.continuations) {
      const fact = continuation.fact;
      const restored = parseRecoverySnapshot(fact.snapshot);
      if (
        continuation.checkpointEventId <= lastCheckpointId ||
        continuation.checkpointEventId > target.acknowledgedEventId ||
        fact.dispatchFactEventId >= fact.snapshotEventId ||
        fact.snapshotEventId >= continuation.checkpointEventId ||
        fact.snapshotEventId < snapshot.acknowledgedEventId ||
        fact.snapshotExternalSequence < snapshot.acknowledgedExternalSequence ||
        fact.snapshotExternalSequence > target.acknowledgedExternalSequence ||
        continuation.payloadHash !== recoverySuffixPayloadHash(fact) ||
        !same(fact.source, page.source) ||
        !same(fact.generation, snapshot.binding.generation) ||
        !same(restored.binding, snapshot.binding) ||
        restored.acknowledgedEventId !== fact.snapshotEventId ||
        restored.acknowledgedExternalSequence !== fact.snapshotExternalSequence ||
        !restored.runtimeContinuation ||
        restored.toolBoundaries.some((boundary) => boundary.kind === "admitted-intent")
      ) throw invalidSuffix();
      lastCheckpointId = continuation.checkpointEventId;
      continuations.push(continuation);
    }
    if (page.nextAfterEventId === null) {
      if (externalSequence !== target.acknowledgedExternalSequence) throw invalidSuffix();
      const final = await input.assertCurrentOwnership();
      if (
        monotonicNow() >= deadline || !same(final.identity, target.identity) ||
        !same(final.generation, target.generation) ||
        final.acknowledgedEventId !== target.acknowledgedEventId ||
        final.acknowledgedExternalSequence !== target.acknowledgedExternalSequence
      ) throw invalidSuffix();
      const suffix = { events, continuations, target: page.target };
      authenticatedSuffixes.set(suffix, {
        snapshot: privateJsonStringify(snapshot),
        suffix: privateJsonStringify(suffix),
      });
      return suffix;
    }
    if (
      page.nextAfterEventId <= afterEventId || page.nextAfterEventId < lastEventId ||
      page.nextAfterEventId < lastCheckpointId ||
      page.nextAfterEventId >= target.acknowledgedEventId
    ) throw invalidSuffix();
    afterEventId = page.nextAfterEventId;
  }
  throw invalidSuffix();
}

/** Restore only an authenticated complete safe fact, then non-state-changing step observations. */
export function materializeAuthenticatedRecoverySuffix(input: {
  snapshot: RecoverySnapshot;
  suffix: {
    events: RecoverySuffixPage["events"];
    continuations: RecoverySuffixPage["continuations"];
    target: RecoverySuffixPage["target"];
  };
}): RecoverySnapshot {
  const proof = authenticatedSuffixes.get(input.suffix);
  let snapshot = parseRecoverySnapshot(input.snapshot);
  if (
    !proof || proof.snapshot !== privateJsonStringify(snapshot) ||
    proof.suffix !== privateJsonStringify(input.suffix)
  ) throw invalidSuffix();
  const latest = input.suffix.continuations.at(-1);
  if (latest) snapshot = parseRecoverySnapshot(latest.fact.snapshot);
  if (!snapshot.runtimeContinuation) throw invalidSuffix();
  for (const event of input.suffix.events) {
    if (event.eventId <= snapshot.acknowledgedEventId) continue;
    if (event.eventType !== "STEP_STARTED" && event.eventType !== "STEP_FINISHED") {
      throw invalidSuffix();
    }
    const payload = event.payload;
    if (
      payload === null || typeof payload !== "object" || isArray(payload) ||
      typeof payload.stepName !== "string" || payload.stepName.length === 0 ||
      payload.stepName.length > 256
    ) throw invalidSuffix();
  }
  return parseRecoverySnapshot({
    ...snapshot,
    acknowledgedEventId: input.suffix.target.acknowledgedEventId,
    acknowledgedExternalSequence: input.suffix.target.acknowledgedExternalSequence,
  });
}
