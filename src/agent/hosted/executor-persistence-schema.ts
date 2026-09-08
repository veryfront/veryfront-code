import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { getConversationRunEventSchema } from "#veryfront/agent/conversation/run-events.ts";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "#veryfront/agent/conversation/run-event-limits.ts";
import { getExecutorDiscoveryIdSchema } from "./executor-discovery-schema.ts";
import { EXECUTOR_MAX_FRAME_BYTES } from "../executor/protocol.ts";

const MAX_PERSISTENCE_ITEMS = 1_000;
const MAX_TOOL_NAMES = 4_096;
const MAX_PROVIDER_BLOCKS = 100;
const MAX_PROVIDER_PARTS = 10_000;
const MAX_PERSISTENCE_PAYLOAD_BYTES = EXECUTOR_MAX_FRAME_BYTES - 2_048;
const encoder = new TextEncoder();

export const executorPersistenceOperations = Object.freeze(
  {
    publishParentRunEvents: "persistence.parent-run-events",
    persistToolExposureCheckpoint: "persistence.tool-exposure-checkpoint",
    persistProviderReplayCheckpoint: "persistence.provider-replay-checkpoint",
  } as const,
);

const getSequenceSchema = defineSchema((v) =>
  v.number().int().positive().max(Number.MAX_SAFE_INTEGER)
);
const getCapabilityRequestSchema = defineSchema((v) =>
  v.object({
    capabilityId: getExecutorDiscoveryIdSchema(),
    sequence: getSequenceSchema(),
  }).strict()
);

/** Identifiers installed by the broker; authority and run ownership are never wire fields. */
export const getExecutorPersistenceCapabilityIdsSchema = defineSchema((v) =>
  v.object({
    publishParentRunEvents: getExecutorDiscoveryIdSchema().optional(),
    toolExposureCheckpoint: getExecutorDiscoveryIdSchema().optional(),
    providerReplayCheckpoint: getExecutorDiscoveryIdSchema().optional(),
  }).strict().refine((value) => {
    const ids = Object.values(value).filter((id): id is string => id !== undefined);
    return new Set(ids).size === ids.length;
  }, "Managed persistence capability IDs must be distinct")
);
export type ExecutorPersistenceCapabilityIds = InferSchema<
  ReturnType<typeof getExecutorPersistenceCapabilityIdsSchema>
>;

export const getExecutorParentRunEventsRequestSchema = defineSchema((v) =>
  getCapabilityRequestSchema().extend({
    events: v.array(
      getConversationRunEventSchema().refine((event) =>
        encoder.encode(JSON.stringify(event)).byteLength <=
          MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
      ),
    ).max(MAX_PERSISTENCE_ITEMS),
  }).strict()
);

export const getExecutorToolExposureCheckpointSchema = defineSchema((v) =>
  v.object({
    version: v.union([v.literal(1), v.literal(2)]),
    loadedToolNames: v.array(v.string().min(1).max(256)).max(MAX_TOOL_NAMES),
  }).strict()
);

export const getExecutorToolExposureCheckpointRequestSchema = defineSchema((_v) =>
  getCapabilityRequestSchema().extend({
    checkpoint: getExecutorToolExposureCheckpointSchema(),
  }).strict()
);

export const getExecutorProviderReplayCheckpointSchema = defineSchema((v) => {
  const provider = v.enum(["anthropic", "openai-responses"] as const);
  return v.object({
    version: v.literal(1),
    messageId: v.string().min(1).max(256),
    provider,
    providerBlocks: v.array(
      v.object({
        type: v.literal("provider-block"),
        provider,
        block: v.record(v.string(), getJsonValueSchema()),
      }).strict(),
    ).min(1).max(MAX_PROVIDER_BLOCKS),
    providerBlockPositions: v.array(v.number().int().nonnegative().max(MAX_PROVIDER_PARTS - 1))
      .min(1).max(MAX_PROVIDER_BLOCKS),
    providerMessageBlockCounts: v.array(v.number().int().positive().max(MAX_PROVIDER_BLOCKS))
      .min(1).max(MAX_PROVIDER_BLOCKS).optional(),
    totalPartCount: v.number().int().positive().max(MAX_PROVIDER_PARTS),
    elapsedMs: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    emittedAt: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  }).strict();
});

export const getExecutorProviderReplayCheckpointRequestSchema = defineSchema((_v) =>
  getCapabilityRequestSchema().extend({
    checkpoint: getExecutorProviderReplayCheckpointSchema(),
  }).strict()
);

export const getExecutorPersistenceAckSchema = defineSchema((v) =>
  v.object({ acknowledged: v.literal(true), sequence: getSequenceSchema() }).strict()
);

export type ExecutorPersistenceAck = InferSchema<
  ReturnType<typeof getExecutorPersistenceAckSchema>
>;

/** Fixed diagnostics do not echo rejected events or opaque replay metadata. */
export function parseExecutorPersistenceData<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid managed persistence data");
  return result.data;
}

/** Copy a validated persistence payload while enforcing the channel envelope budget. */
export function executorPersistenceJson(value: unknown): JsonValue {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError("Invalid managed persistence data");
  }
  if (
    encoded === undefined ||
    encoder.encode(encoded).byteLength > MAX_PERSISTENCE_PAYLOAD_BYTES
  ) throw new TypeError("Invalid managed persistence data");
  const snapshot = snapshotBoundedJsonValue(JSON.parse(encoded));
  if (!snapshot.success) throw new TypeError("Invalid managed persistence data");
  return snapshot.value;
}
