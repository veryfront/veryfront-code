import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema } from "#veryfront/schemas/index.ts";
import { defineError, VeryfrontError } from "#veryfront/errors/types.ts";
import { getExecutorDiscoveryIdSchema } from "./executor-discovery-schema.ts";

const failureStatus = {
  EXECUTOR_RUNTIME_INVALID_INPUT: 400,
  EXECUTOR_RUNTIME_NOT_GRANTED: 403,
  EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE: 503,
  EXECUTOR_RUNTIME_ALREADY_PREPARED: 409,
  EXECUTOR_RUNTIME_NOT_PREPARED: 409,
  EXECUTOR_RUNTIME_PREPARATION_FAILED: 500,
  EXECUTOR_RUNTIME_CLEANUP_FAILED: 500,
  EXECUTOR_RUNTIME_CLOSED: 410,
  ABORTED: 499,
} as const;
export class ExecutorRuntimePreparationError extends VeryfrontError {
  constructor(readonly code: keyof typeof failureStatus) {
    super(
      code,
      defineError({
        slug: code.toLowerCase().replaceAll("_", "-"),
        category: "AGENT",
        status: failureStatus[code],
        title: code,
      }),
    );
  }
}
const getNames = defineSchema((v) => v.array(getExecutorDiscoveryIdSchema()).max(256));
const getPositiveLimit = defineSchema((v) =>
  v.number().int().positive().max(Number.MAX_SAFE_INTEGER)
);
export const getExecutorRuntimePrepareRequestSchema = defineSchema((v) =>
  v.object({
    agentId: getExecutorDiscoveryIdSchema(),
    modelId: getExecutorDiscoveryIdSchema().optional(),
    instructions: v.union([
      v.string(),
      v.array(
        v.object({
          role: v.literal("system"),
          content: v.string(),
          providerOptions: v.record(v.string(), getJsonValueSchema()).optional(),
        }).strict(),
      ).max(256),
    ]).optional(),
    temperature: v.number().min(0).max(2).optional(),
    thinking: v.object({ enabled: v.boolean(), budgetTokens: getPositiveLimit().optional() })
      .strict().optional(),
    maxSteps: getPositiveLimit().optional(),
    maxOutputTokens: getPositiveLimit().optional(),
    allowedToolNames: getNames().optional(),
    providerToolNames: getNames().optional(),
  }).strict()
);
export type ExecutorRuntimePrepareRequest = InferSchema<
  ReturnType<typeof getExecutorRuntimePrepareRequestSchema>
>;

export const getExecutorRuntimeGrantDataSchema = defineSchema((v) => {
  const context = {
    projectId: v.string().nullable(),
    projectSlug: v.string().optional(),
    branchId: v.string().nullable().optional(),
    userId: v.string().optional(),
  };
  return v.object({
    agentId: getExecutorDiscoveryIdSchema(),
    defaultModelId: getExecutorDiscoveryIdSchema(),
    maxSteps: getPositiveLimit(),
    models: v.array(
      v.object({
        id: getExecutorDiscoveryIdSchema(),
        maxOutputTokens: getPositiveLimit(),
        providerToolNames: getNames(),
      }).strict(),
    ).min(1).max(128),
    allowedToolNames: getNames(),
    hostToolFacadeIds: getNames(),
    remoteToolSourceIds: getNames(),
    requiredCapabilities: v.array(v.enum(["project-steering", "conversation-user-text"] as const))
      .max(2).optional(),
    execution: v.discriminatedUnion("kind", [
      v.object({ kind: v.literal("ephemeral"), ...context }).strict(),
      v.object({
        kind: v.literal("canonical"),
        ...context,
        conversationId: getExecutorDiscoveryIdSchema(),
        runId: getExecutorDiscoveryIdSchema(),
        messageId: getExecutorDiscoveryIdSchema(),
        providerReplay: v.enum(["required", "disabled"] as const),
      }).strict(),
    ]),
  }).strict();
});
export type ExecutorRuntimeGrantData = InferSchema<
  ReturnType<typeof getExecutorRuntimeGrantDataSchema>
>;

export function parseRuntimePreparationData<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ExecutorRuntimePreparationError("EXECUTOR_RUNTIME_INVALID_INPUT");
  return result.data;
}
