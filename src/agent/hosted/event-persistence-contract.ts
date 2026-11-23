import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Shared acknowledgment for a privately negotiated runtime event writer. */
export const RUNTIME_EVENT_PERSISTENCE_HEADER = "X-Veryfront-Run-Event-Persistence";
export const RUNTIME_EVENT_PERSISTENCE_MODE = "runtime-owned-v1";

/** API-owned lifecycle with an exact canonical mapped-event writer snapshot. */
export const getProjectEventPersistenceSchema = defineSchema((v) =>
  v.object({
    mode: v.literal(RUNTIME_EVENT_PERSISTENCE_MODE),
    canonicalRunId: v.string().uuid(),
    latestEventId: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    latestExternalEventSequence: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict()
);
export type ProjectEventPersistence = InferSchema<
  ReturnType<typeof getProjectEventPersistenceSchema>
>;
