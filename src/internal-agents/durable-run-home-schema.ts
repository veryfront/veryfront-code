import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

export const MAX_DURABLE_RECORD_BYTES = 1024 * 1024;
export const MAX_DURABLE_RECORDS = 4096;
export const MAX_DURABLE_HOME_BYTES = 64 * 1024 * 1024;
export const getDurableRunIdentitySchema = defineSchema((v) =>
  v.object({
    projectId: v.string().uuid(),
    canonicalRunId: v.string().uuid(),
    publicRunId: v.string().min(1).max(256),
    sourceHash: v.string().regex(/^[a-f0-9]{64}$/),
  }).strict()
);
export type DurableRunIdentity = InferSchema<ReturnType<typeof getDurableRunIdentitySchema>>;

/** Copy data-only checkpoint/event payloads; credentials must never be supplied by callers. */
export function snapshotDurableValue(value: unknown) {
  const snapshot = snapshotBoundedJsonValue(
    value,
    MAX_DURABLE_RECORD_BYTES,
    MAX_DURABLE_RECORD_BYTES,
  );
  if (!snapshot.success) throw new Error("Invalid durable run data");
  return snapshot.value;
}
