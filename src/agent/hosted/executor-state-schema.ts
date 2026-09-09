import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  getExecutorAgentDefinitionSchema,
  getExecutorDiscoveryIdSchema,
} from "./executor-discovery-schema.ts";
import { EXECUTOR_MAX_FRAME_BYTES } from "../executor/protocol.ts";

const MAX_STATE_PAYLOAD_BYTES = EXECUTOR_MAX_FRAME_BYTES - 2_048;
const MAX_SKILLS = 128;
const MAX_ARRAY_ITEMS = 3_000;
const MAX_TEXT_LENGTH = 1_048_576;
const encoder = new TextEncoder();
const forbiddenProviderFields = new Set([
  "headers",
  "authorization",
  "auth",
  "apikey",
  "apitoken",
  "authtoken",
  "credential",
  "credentials",
  "baseurl",
  "url",
  "endpoint",
  "fetch",
  "signal",
  "abortsignal",
]);

export const executorStateOperations = Object.freeze(
  {
    prepareProjectSteering: "state.project-steering.prepare",
    refreshProjectSteering: "state.project-steering.refresh",
    latestConversationUserText: "state.conversation-user-text",
  } as const,
);

export const getExecutorStateCapabilityIdsSchema = defineSchema((v) =>
  v.object({
    projectSteering: getExecutorDiscoveryIdSchema().optional(),
    conversationUserText: getExecutorDiscoveryIdSchema().optional(),
  }).strict().refine((value) => {
    const ids = Object.values(value).filter((id): id is string => id !== undefined);
    return new Set(ids).size === ids.length;
  }, "Managed state capability IDs must be distinct")
);
export type ExecutorStateCapabilityIds = InferSchema<
  ReturnType<typeof getExecutorStateCapabilityIdsSchema>
>;

const getCapabilityRequestSchema = defineSchema((v) =>
  v.object({ capabilityId: getExecutorDiscoveryIdSchema() }).strict()
);
export const getExecutorProjectSteeringPrepareRequestSchema = defineSchema((_v) =>
  getCapabilityRequestSchema().extend({ definition: getExecutorAgentDefinitionSchema() }).strict()
);
export const getExecutorStateReadRequestSchema = getCapabilityRequestSchema;
export const getExecutorProjectSteeringRefreshRequestSchema = defineSchema((v) =>
  getCapabilityRequestSchema().extend({
    availableToolNames: v.array(getExecutorDiscoveryIdSchema()).max(1_000).optional(),
  }).strict()
);

const getSkillSelectorPolicySchema = defineSchema((v) =>
  v.discriminatedUnion("kind", [
    v.object({ kind: v.literal("all-visible"), source: v.enum(["omitted", "true"] as const) })
      .strict(),
    v.object({ kind: v.literal("none") }).strict(),
    v.object({
      kind: v.literal("allowlist"),
      entries: v.array(getExecutorDiscoveryIdSchema()).max(1_000),
    }).strict(),
  ])
);
const getRuntimeSkillDefinitionSchema = defineSchema((v) =>
  v.object({
    id: getExecutorDiscoveryIdSchema(),
    name: v.string().min(1).max(256),
    displayName: v.string().max(256).optional(),
    description: v.string().max(MAX_TEXT_LENGTH),
    instructions: v.string().max(MAX_TEXT_LENGTH),
    allowedTools: v.array(v.string().min(1).max(256)).max(100).optional(),
    metadata: v.record(v.string().max(256), v.string().max(4_096)).optional(),
    model: v.string().min(1).max(256).optional(),
    thinking: v.union([v.literal(false), v.number().int().positive().max(1_000_000)]).optional(),
    maxSteps: v.number().int().positive().max(1_000).optional(),
    references: v.array(v.string().min(1).max(4_096)).max(MAX_ARRAY_ITEMS).optional(),
    ownerAgentId: getExecutorDiscoveryIdSchema().optional(),
    shortName: v.string().min(1).max(256).optional(),
    sourcePath: v.string().min(1).max(4_096).optional(),
  }).strict()
);
export const getExecutorProjectSteeringResultSchema = defineSchema((v) =>
  v.object({
    agent: getExecutorAgentDefinitionSchema(),
    skillSelectorPolicy: getSkillSelectorPolicySchema().optional(),
    environmentContext: v.string().max(MAX_TEXT_LENGTH).optional(),
    initialProjectInstructions: v.string().max(MAX_TEXT_LENGTH).optional(),
    initialSkills: v.array(getRuntimeSkillDefinitionSchema()).max(MAX_SKILLS).optional(),
  }).strict()
);

const getProviderOptionsSchema = defineSchema((v) =>
  v.record(v.string().max(256), getJsonValueSchema()).refine((value) => {
    for (const field of Object.keys(value)) {
      if (forbiddenProviderFields.has(field.replace(/[-_]/g, "").toLowerCase())) return false;
    }
    for (const bucket of Object.values(value)) {
      if (bucket === null || typeof bucket !== "object" || Array.isArray(bucket)) continue;
      for (const field of Object.keys(bucket)) {
        if (forbiddenProviderFields.has(field.replace(/[-_]/g, "").toLowerCase())) return false;
      }
    }
    return true;
  }, "Managed state provider transport fields are forbidden")
);
export const getExecutorAgentSystemSchema = defineSchema((v) =>
  v.union([
    v.string().max(MAX_TEXT_LENGTH),
    v.array(
      v.object({
        role: v.literal("system"),
        content: v.string().max(MAX_TEXT_LENGTH),
        providerOptions: getProviderOptionsSchema().optional(),
      }).strict(),
    ).max(256),
  ])
);
export const getExecutorConversationUserTextResultSchema = defineSchema((v) =>
  v.object({ text: v.string().max(MAX_TEXT_LENGTH).nullable() }).strict()
);

export function parseExecutorStateData<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid managed state data");
  return result.data;
}

export function executorStateJson(value: unknown): JsonValue {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError("Invalid managed state data");
  }
  if (encoded === undefined || encoder.encode(encoded).byteLength > MAX_STATE_PAYLOAD_BYTES) {
    throw new TypeError("Invalid managed state data");
  }
  const snapshot = snapshotBoundedJsonValue(JSON.parse(encoded));
  if (!snapshot.success) throw new TypeError("Invalid managed state data");
  return snapshot.value;
}
