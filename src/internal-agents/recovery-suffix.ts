import { pushPrivateArray, somePrivateArray } from "#veryfront/security/private-array.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  getRecoveryGenerationSchema,
  getRecoverySourceBindingSchema,
} from "./recovery-admission-schema.ts";

import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

export const MAX_RECOVERY_SUFFIX_EVENT_BYTES = 10 * 1024 * 1024;
export const MAX_RECOVERY_SUFFIX_ROWS = 100;
export const MAX_RECOVERY_SUFFIX_PAGE_BYTES = 256 * 1024;
// The API admits event append bodies up to 10 MiB. A single persisted entry
// may need that full budget plus the ordinary page's identity and fencing envelope.
export const MAX_RECOVERY_SUFFIX_SINGLE_ENTRY_PAGE_BYTES = MAX_RECOVERY_SUFFIX_EVENT_BYTES +
  MAX_RECOVERY_SUFFIX_PAGE_BYTES;
export const MAX_RECOVERY_SUFFIX_PAGES = 32;
export const MAX_RECOVERY_SUFFIX_BYTES = 32 * 1024 * 1024;

const getRecoverySuffixPayloadSchema = defineSchema((v) =>
  v.custom<unknown>(() => true)
    .transform((value) =>
      snapshotBoundedJsonValue(
        value,
        MAX_RECOVERY_SUFFIX_EVENT_BYTES,
        MAX_RECOVERY_SUFFIX_EVENT_BYTES,
      )
    )
    .refine((snapshot) => snapshot.success, "Expected a bounded recovery event payload")
    .transform((snapshot) => snapshot.success ? snapshot.value : null)
);

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
        payload: getRecoverySuffixPayloadSchema(),
        appendGeneration: getRecoveryGenerationSchema(),
        dispatchFactEventId: eventId,
        payloadHash: hash,
      }).strict(),
    ).max(MAX_RECOVERY_SUFFIX_ROWS),
    nextAfterEventId: eventId.nullable(),
  }).strict();
});
export type RecoverySuffixPage = InferSchema<ReturnType<typeof getRecoverySuffixPageSchema>>;

import { privateSha256Hex } from "#veryfront/security/private-sha256.ts";
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
  const value = getRecoverySuffixPayloadSchema().parse(payload);
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
  return privateSha256Hex(canonical(value));
}

type RecoverySuffixAdmission = NonNullable<
  ReturnType<typeof getVerifiedControlPlaneRecoveryAdmission>
>;
type RecoverySuffixEqual = (left: unknown, right: unknown) => boolean;

function assertRecoverySuffixOwnershipBinding(
  target: RecoveryOwnershipReceipt,
  admission: RecoverySuffixAdmission,
  snapshot: RecoverySnapshot | undefined,
  same: RecoverySuffixEqual,
): void {
  if (
    target.identity.projectId !== admission.identity.projectId ||
    target.identity.canonicalRunId !== admission.identity.canonicalRunId ||
    target.identity.publicRunId !== admission.identity.publicRunId ||
    target.identity.agentId !== admission.identity.agentId ||
    target.identity.threadId !== admission.identity.threadId ||
    !same(target.generation, admission.generation) ||
    (snapshot !== undefined && (
      !same(snapshot.binding.identity, admission.identity) ||
      !same(snapshot.binding.sourceBinding, admission.sourceBinding) ||
      snapshot.acknowledgedEventId > target.acknowledgedEventId ||
      snapshot.acknowledgedExternalSequence > target.acknowledgedExternalSequence
    ))
  ) throw invalidSuffix();
}

function assertRecoverySuffixPageEnvelope(
  page: RecoverySuffixPage,
  bytes: number,
  deadline: number,
  pageStarted: number,
  target: RecoveryOwnershipReceipt,
  admission: RecoverySuffixAdmission,
  same: RecoverySuffixEqual,
): void {
  if (
    bytes > MAX_RECOVERY_SUFFIX_PAGE_BYTES &&
    page.events.length + page.continuations.length !== 1
  ) throw invalidSuffix();
  if (
    monotonicNow() >= Math.min(deadline, pageStarted + page.leaseRemainingMs) ||
    !same(page.identity, target.identity) || !same(page.generation, admission.generation) ||
    !same(page.source.sourceBinding, admission.sourceBinding) ||
    page.source.sourceHash !== admission.identity.sourceHash ||
    page.target.acknowledgedEventId !== target.acknowledgedEventId ||
    page.target.acknowledgedExternalSequence !== target.acknowledgedExternalSequence
  ) throw invalidSuffix();
}

function readRecoverySuffixSeed(
  snapshot: RecoverySnapshot | undefined,
  page: RecoverySuffixPage,
  admission: RecoverySuffixAdmission,
  target: RecoveryOwnershipReceipt,
  same: RecoverySuffixEqual,
): RecoverySnapshot | undefined {
  const first = page.continuations[0];
  if (!snapshot && first) {
    snapshot = parseRecoverySnapshot(first.fact.snapshot);
    if (
      !same(snapshot.binding.identity, admission.identity) ||
      !same(snapshot.binding.sourceBinding, admission.sourceBinding) ||
      snapshot.acknowledgedExternalSequence !== 1 ||
      snapshot.acknowledgedEventId > target.acknowledgedEventId
    ) throw invalidSuffix();
  }
  return snapshot;
}

function appendRecoverySuffixEvents(
  page: RecoverySuffixPage,
  events: RecoverySuffixPage["events"],
  afterEventId: number,
  target: RecoveryOwnershipReceipt,
  externalSequence: number,
): { lastEventId: number; externalSequence: number } {
  let lastEventId = afterEventId;
  for (let eventIndex = 0; eventIndex < page.events.length; eventIndex++) {
    const event = page.events[eventIndex]!;
    if (
      event.eventId <= lastEventId || event.eventId > target.acknowledgedEventId ||
      event.dispatchFactEventId >= event.eventId ||
      event.payloadHash !== recoverySuffixPayloadHash(event.payload)
    ) throw invalidSuffix();
    lastEventId = event.eventId;
    if (event.externalSequence !== null && event.externalSequence !== ++externalSequence) {
      throw invalidSuffix();
    }
    pushPrivateArray(events, event);
  }
  return { lastEventId, externalSequence };
}

function assertRecoverySuffixContinuationCursor(
  continuation: RecoverySuffixPage["continuations"][number],
  fact: RecoverySuffixPage["continuations"][number]["fact"],
  snapshot: RecoverySnapshot,
  previous: RecoverySuffixPage["continuations"][number]["fact"] | undefined,
  target: RecoveryOwnershipReceipt,
  lastCheckpointId: number,
): void {
  if (
    continuation.checkpointEventId <= lastCheckpointId ||
    continuation.checkpointEventId > target.acknowledgedEventId ||
    fact.dispatchFactEventId >= fact.snapshotEventId ||
    fact.snapshotEventId >= continuation.checkpointEventId ||
    (previous !== undefined && (
      fact.snapshotEventId < previous.snapshotEventId ||
      fact.snapshotExternalSequence < previous.snapshotExternalSequence
    )) ||
    fact.snapshotEventId < snapshot.acknowledgedEventId ||
    fact.snapshotExternalSequence < snapshot.acknowledgedExternalSequence ||
    fact.snapshotExternalSequence > target.acknowledgedExternalSequence
  ) throw invalidSuffix();
}

function assertRecoverySuffixContinuationIntegrity(
  continuation: RecoverySuffixPage["continuations"][number],
  fact: RecoverySuffixPage["continuations"][number]["fact"],
  restored: RecoverySnapshot,
  page: RecoverySuffixPage,
  admission: RecoverySuffixAdmission,
  same: RecoverySuffixEqual,
): void {
  if (
    continuation.payloadHash !== recoverySuffixPayloadHash(fact) ||
    !same(fact.source, page.source) ||
    !same(restored.binding.generation, fact.generation) ||
    !same(restored.binding.identity, admission.identity) ||
    !same(restored.binding.sourceBinding, admission.sourceBinding) ||
    restored.acknowledgedEventId !== fact.snapshotEventId ||
    restored.acknowledgedExternalSequence !== fact.snapshotExternalSequence ||
    !restored.runtimeContinuation ||
    somePrivateArray(restored.toolBoundaries, (boundary) => boundary.kind === "admitted-intent")
  ) throw invalidSuffix();
}

function sealAuthenticatedRecoverySuffix(
  input: Parameters<typeof readAuthenticatedRecoverySuffix>[0],
  state: {
    snapshot: RecoverySnapshot;
    events: RecoverySuffixPage["events"];
    continuations: RecoverySuffixPage["continuations"];
    bootstrap: boolean;
    deadline: number;
  },
  page: RecoverySuffixPage,
  same: RecoverySuffixEqual,
) {
  let { snapshot } = state;
  const { events, continuations, bootstrap, deadline } = state;
  const latest = continuations[continuations.length - 1];
  const selected = latest ? parseRecoverySnapshot(latest.fact.snapshot) : snapshot;
  const anchorGeneration = input.snapshot?.binding.generation;
  // Discarding an earlier complete prefix does not waive its provenance:
  // every generation must be the supplied local anchor or have its own
  // authenticated sealed continuation and exact dispatch fact.
  if (
    somePrivateArray(
      events,
      (event) =>
        !(anchorGeneration && same(event.appendGeneration, anchorGeneration)) &&
        !somePrivateArray(continuations, ({ fact }) =>
          same(event.appendGeneration, fact.generation) &&
          event.dispatchFactEventId === fact.dispatchFactEventId),
    )
  ) throw invalidSuffix();
  const generation = selected.binding.generation;
  const selectedEventId = selected.acknowledgedEventId;
  if (
    somePrivateArray(events, (event) =>
      event.eventId > selectedEventId &&
      !same(event.appendGeneration, generation))
  ) throw invalidSuffix();
  if (bootstrap) {
    if (!latest) throw invalidSuffix();
    snapshot = selected;
  }
  if (monotonicNow() >= deadline) throw invalidSuffix();
  const suffix = { snapshot, events, continuations, target: page.target };
  authenticatedSuffixes.set(suffix, {
    snapshot: privateJsonStringify(snapshot),
    suffix: privateJsonStringify(suffix),
  });
  return suffix;
}

function appendRecoverySuffixContinuations(
  page: RecoverySuffixPage,
  continuations: RecoverySuffixPage["continuations"],
  snapshot: RecoverySnapshot | undefined,
  afterEventId: number,
  target: RecoveryOwnershipReceipt,
  admission: RecoverySuffixAdmission,
  same: RecoverySuffixEqual,
): number {
  let lastCheckpointId = afterEventId;
  for (
    let continuationIndex = 0;
    continuationIndex < page.continuations.length;
    continuationIndex++
  ) {
    const continuation = page.continuations[continuationIndex]!;
    if (!snapshot) throw invalidSuffix();
    const fact = continuation.fact;
    const restored = parseRecoverySnapshot(fact.snapshot);
    const previous = continuations[continuations.length - 1]?.fact;
    assertRecoverySuffixContinuationCursor(
      continuation,
      fact,
      snapshot,
      previous,
      target,
      lastCheckpointId,
    );
    assertRecoverySuffixContinuationIntegrity(
      continuation,
      fact,
      restored,
      page,
      admission,
      same,
    );
    lastCheckpointId = continuation.checkpointEventId;
    pushPrivateArray(continuations, continuation);
  }
  return lastCheckpointId;
}

function assertRecoverySuffixFinalOwnership(
  final: RecoveryOwnershipReceipt,
  target: RecoveryOwnershipReceipt,
  deadline: number,
  same: RecoverySuffixEqual,
): void {
  if (
    monotonicNow() >= deadline || !same(final.identity, target.identity) ||
    !same(final.generation, target.generation) ||
    final.acknowledgedEventId !== target.acknowledgedEventId ||
    final.acknowledgedExternalSequence !== target.acknowledgedExternalSequence
  ) throw invalidSuffix();
}

/**
 * Reads only authenticated, bounded raw suffix pages. It never derives continuation
 * state from transcript length, a tool result, or a global database cursor.
 */
export async function readAuthenticatedRecoverySuffix(input: {
  snapshot?: RecoverySnapshot;
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
    snapshot: RecoverySnapshot;
    events: RecoverySuffixPage["events"];
    continuations: RecoverySuffixPage["continuations"];
    target: RecoverySuffixPage["target"];
  }
> {
  const admission = getVerifiedControlPlaneRecoveryAdmission(input.claims);
  if (!admission) throw invalidSuffix();
  const bootstrap = input.snapshot === undefined;
  let snapshot = input.snapshot === undefined ? undefined : parseRecoverySnapshot(input.snapshot);
  const initialStarted = monotonicNow();
  const target = await input.assertCurrentOwnership();
  const deadline = Math.min(initialStarted + target.leaseRemainingMs, initialStarted + 10_000);
  const same = (left: unknown, right: unknown) =>
    privateJsonStringify(left) === privateJsonStringify(right);
  assertRecoverySuffixOwnershipBinding(target, admission, snapshot, same);
  let afterEventId = snapshot?.acknowledgedEventId ?? 0;
  let externalSequence = snapshot?.acknowledgedExternalSequence ?? 0;
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
    if (
      bytes > MAX_RECOVERY_SUFFIX_SINGLE_ENTRY_PAGE_BYTES ||
      totalBytes > MAX_RECOVERY_SUFFIX_BYTES
    ) {
      throw invalidSuffix();
    }
    const page = getRecoverySuffixPageSchema().parse(raw);
    assertRecoverySuffixPageEnvelope(page, bytes, deadline, pageStarted, target, admission, same);
    // A large transcript and its sealed continuation may occupy separate
    // bounded pages. Buffer authenticated rows until the first sealed seed;
    // complete prefix provenance is checked before selecting the latest seed.
    snapshot = readRecoverySuffixSeed(snapshot, page, admission, target, same);
    const appended = appendRecoverySuffixEvents(
      page,
      events,
      afterEventId,
      target,
      externalSequence,
    );
    const lastEventId = appended.lastEventId;
    externalSequence = appended.externalSequence;
    const lastCheckpointId = appendRecoverySuffixContinuations(
      page,
      continuations,
      snapshot,
      afterEventId,
      target,
      admission,
      same,
    );
    if (page.nextAfterEventId === null) {
      if (!snapshot || externalSequence !== target.acknowledgedExternalSequence) {
        throw invalidSuffix();
      }
      const final = await input.assertCurrentOwnership();
      assertRecoverySuffixFinalOwnership(final, target, deadline, same);
      return sealAuthenticatedRecoverySuffix(
        input,
        { snapshot, events, continuations, bootstrap, deadline },
        page,
        same,
      );
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

function hasAuthenticatedRecoverySuffixProof(
  proof: ReturnType<typeof authenticatedSuffixes.get>,
  snapshot: RecoverySnapshot,
  input: Parameters<typeof materializeAuthenticatedRecoverySuffix>[0],
): boolean {
  if (!proof) return false;
  return proof.snapshot === privateJsonStringify(snapshot) &&
    proof.suffix === privateJsonStringify(input.suffix);
}

function assertRecoverySuffixStepPayload(event: RecoverySuffixPage["events"][number]): void {
  const payload = event.payload;
  if (
    payload === null || typeof payload !== "object" || isArray(payload) ||
    typeof payload.stepName !== "string" || payload.stepName.length === 0 ||
    payload.stepName.length > 256
  ) throw invalidSuffix();
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
  if (!hasAuthenticatedRecoverySuffixProof(proof, snapshot, input)) throw invalidSuffix();
  const latest = input.suffix.continuations[input.suffix.continuations.length - 1];
  if (latest) snapshot = parseRecoverySnapshot(latest.fact.snapshot);
  if (!snapshot.runtimeContinuation) throw invalidSuffix();
  for (let eventIndex = 0; eventIndex < input.suffix.events.length; eventIndex++) {
    const event = input.suffix.events[eventIndex]!;
    if (event.eventId <= snapshot.acknowledgedEventId) continue;
    if (event.eventType === "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED") {
      const expected = { type: event.eventType, ...snapshot.toolExposureCheckpoint };
      if (recoverySuffixPayloadHash(event.payload) !== recoverySuffixPayloadHash(expected)) {
        throw invalidSuffix();
      }
      continue;
    }
    if (event.eventType !== "STEP_STARTED" && event.eventType !== "STEP_FINISHED") {
      throw invalidSuffix();
    }
    assertRecoverySuffixStepPayload(event);
  }
  return parseRecoverySnapshot({
    ...snapshot,
    acknowledgedEventId: input.suffix.target.acknowledgedEventId,
    acknowledgedExternalSequence: input.suffix.target.acknowledgedExternalSequence,
  });
}
