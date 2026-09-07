import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import { defineSchema, getJsonValueSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const MAX_MODELS = 128;
const MAX_ITEMS = 1000;

const getModelIdSchema = defineSchema((v) => v.string().min(1).max(256));

// First-party builders shallow-merge canonical and gateway provider buckets
// into upstream request bodies. Model selection belongs to the broker's
// allowlist, including when a provider-name alias selects the bucket. This
// reservation covers the supported request contracts, not arbitrary future
// provider transports; new builders must keep model selection broker-owned.
const BROKER_MODEL_SELECTION_FIELDS = new Set([
  "model",
  "modelid",
  "modelname",
  "modelprovider",
  "provider",
  "deployment",
  "deploymentid",
  "deploymentname",
  "engine",
]);

// These are configuration fields at each provider bucket root. Nested schemas,
// tool data, and replay data may use the same names as ordinary properties.
const BROKER_TRANSPORT_FIELDS = new Set([
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

const getProviderOptionsSchema = defineSchema((v) =>
  v.record(v.string(), getJsonValueSchema()).refine((value) => {
    for (const bucket of Object.values(value)) {
      if (bucket === null || typeof bucket !== "object" || Array.isArray(bucket)) continue;
      for (const field of Object.keys(bucket)) {
        const normalized = field.replace(/[-_]/g, "").toLowerCase();
        if (
          BROKER_MODEL_SELECTION_FIELDS.has(normalized) || BROKER_TRANSPORT_FIELDS.has(normalized)
        ) {
          return false;
        }
      }
    }
    return true;
  }, "Managed model request overrides are forbidden")
);

/** The provider-neutral call contract, excluding headers and local cancellation objects. */
export const getExecutorModelOptionsSchema = defineSchema((v) => {
  const json = getJsonValueSchema();
  const text = v.object({ type: v.literal("text"), text: v.string() }).strict();
  const toolIdentity = { toolCallId: v.string(), toolName: v.string() };
  const providerFlags = {
    dynamic: v.boolean().optional(),
    supportsDeferredResults: v.boolean().optional(),
  };
  const prompt = v.discriminatedUnion("role", [
    v.object({
      role: v.literal("system"),
      content: v.string(),
      providerOptions: getProviderOptionsSchema().optional(),
    }).strict(),
    v.object({
      role: v.literal("user"),
      content: v.array(v.union([
        text,
        v.object({
          type: v.enum(["image", "file"] as const),
          mediaType: v.string(),
          url: v.string(),
          filename: v.string().optional(),
        }).strict(),
      ])).max(MAX_ITEMS),
    }).strict(),
    v.object({
      role: v.literal("assistant"),
      content: v.array(v.discriminatedUnion("type", [
        text,
        v.object({
          type: v.literal("reasoning"),
          text: v.string().optional(),
          signature: v.string().optional(),
          redactedData: v.string().optional(),
        }).strict(),
        v.object({
          type: v.literal("tool-call"),
          ...toolIdentity,
          input: json,
          providerExecuted: v.boolean().optional(),
          ...providerFlags,
        }).strict(),
        v.object({
          type: v.literal("tool-result"),
          ...toolIdentity,
          result: json,
          providerExecuted: v.literal(true),
          isError: v.boolean().optional(),
          ...providerFlags,
        }).strict(),
      ])).max(MAX_ITEMS),
      providerToolCalls: v.array(
        v.object({ ...toolIdentity, input: json, supportsDeferredResults: v.boolean().optional() })
          .strict(),
      ).max(MAX_ITEMS).optional(),
      providerMetadata: v.record(v.string(), json).optional(),
    }).strict(),
    v.object({
      role: v.literal("tool"),
      content: v.array(
        v.object({
          type: v.literal("tool-result"),
          ...toolIdentity,
          output: v.object({ type: v.literal("json"), value: json }).strict(),
        }).strict(),
      ).max(MAX_ITEMS),
    }).strict(),
  ]);
  return v.object({
    prompt: v.array(prompt).max(MAX_ITEMS),
    maxOutputTokens: v.number().int().positive().optional(),
    temperature: v.number().optional(),
    topP: v.number().optional(),
    topK: v.number().int().nonnegative().optional(),
    stopSequences: v.array(v.string()).max(MAX_ITEMS).optional(),
    tools: v.array(v.discriminatedUnion("type", [
      v.object({
        type: v.literal("function"),
        name: v.string(),
        description: v.string().optional(),
        inputSchema: json,
      }).strict(),
      v.object({
        type: v.literal("provider"),
        name: v.string(),
        id: v.string().regex(/^.+\..+$/).transform((id) => id as `${string}.${string}`),
        args: v.record(v.string(), json),
      }).strict(),
    ])).max(MAX_ITEMS).optional(),
    toolChoice: json.optional(),
    seed: v.number().int().optional(),
    presencePenalty: v.number().optional(),
    frequencyPenalty: v.number().optional(),
    providerOptions: getProviderOptionsSchema().optional(),
    reasoning: v.object({
      enabled: v.boolean().optional(),
      effort: v.enum(["low", "medium", "high", "max"] as const).optional(),
      budgetTokens: v.number().int().nonnegative().optional(),
    }).strict().optional(),
    includeRawChunks: v.boolean().optional(),
    userId: v.string().optional(),
    responseFormat: v.discriminatedUnion("type", [
      v.object({ type: v.literal("text") }).strict(),
      v.object({ type: v.literal("json") }).strict(),
      v.object({
        type: v.literal("json_schema"),
        name: v.string(),
        schema: json,
        description: v.string().optional(),
        strict: v.boolean().optional(),
      }).strict(),
    ]).optional(),
  }).strict();
});

export const getExecutorModelRequestSchema = defineSchema((v) =>
  v.object({ modelId: getModelIdSchema() }).strict()
);

export const getExecutorModelReconciliationSchema = defineSchema((v) =>
  v.object({
    modelId: getModelIdSchema(),
    providerMetadata: v.record(v.string(), getJsonValueSchema()),
    suppressedToolCalls: v.array(
      v.object({
        id: v.string().min(1).max(256),
        name: v.string().min(1).max(256),
      }).strict(),
    ).max(MAX_ITEMS),
  }).strict()
);

export const getExecutorModelReconciliationResultSchema = defineSchema((v) =>
  v.object({ providerMetadata: v.record(v.string(), getJsonValueSchema()).optional() }).strict()
);

export const getExecutorModelCallSchema = defineSchema((v) =>
  v.object({ modelId: getModelIdSchema(), options: getExecutorModelOptionsSchema() }).strict()
);

export const getExecutorModelMetadataSchema = defineSchema((v) =>
  v.array(
    v.object({
      id: getModelIdSchema(),
      specificationVersion: v.string().max(128).optional(),
      provider: v.string().max(256).optional(),
      modelId: getModelIdSchema().optional(),
      modelProvider: v.string().max(256).optional(),
      executionMode: v.enum(["remote", "server-local"] as const).optional(),
      runtimeCapabilities: v.object({
        toolCalling: v.boolean().optional(),
        structuredOutput: v.union([
          v.boolean(),
          v.array(v.enum(["json", "json_schema"] as const)).max(2),
        ]).optional(),
      }).strict().optional(),
      _generateViaStream: v.boolean().optional(),
      reconcilesProviderMetadata: v.boolean().optional(),
    }).strict(),
  ).max(MAX_MODELS)
);

export type ExecutorModelMetadata = InferSchema<
  ReturnType<typeof getExecutorModelMetadataSchema>
>[number];

export const getExecutorModelGenerateResultSchema = defineSchema((v) =>
  v.object({
    content: v.array(getJsonValueSchema()).max(MAX_ITEMS).optional(),
    finishReason: getJsonValueSchema().optional(),
    usage: getJsonValueSchema().optional(),
    warnings: v.array(getJsonValueSchema()).max(MAX_ITEMS).optional(),
    providerMetadata: v.record(v.string(), getJsonValueSchema()).optional(),
  }).strict()
);

export const getExecutorModelStreamFrameSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("start"),
      warnings: v.array(getJsonValueSchema()).max(MAX_ITEMS).optional(),
    }).strict(),
    v.object({ type: v.literal("chunk"), value: getJsonValueSchema() }).strict(),
  ])
);

export const getExecutorModelEmptySchema = defineSchema((v) => v.object({}).strict());

/** Schema diagnostics never expose rejected model inputs or provider output. */
export function parseExecutorModelData<T>(schema: Schema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid managed model data");
  return result.data;
}

export function executorModelIds(ids: ReadonlySet<string>): Set<string> {
  if (!(ids instanceof Set) || ids.size === 0 || ids.size > MAX_MODELS) {
    throw new TypeError("Invalid managed model allowlist");
  }
  for (const id of ids) parseExecutorModelData(getModelIdSchema(), id);
  return new Set(ids);
}

/**
 * Runtime structs commonly contain optional properties with undefined values.
 * Omit those properties, but reject executable, cyclic, or non-JSON values.
 * The final shared snapshot enforces string, key, and serialized byte limits.
 */
export function executorModelJson(value: unknown): JsonValue {
  let nodes = 0;
  const ancestors = new Set<object>();
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 128) throw new TypeError("Invalid managed model data");
    if (input === null || typeof input !== "object") return input;
    if (ancestors.has(input)) throw new TypeError("Invalid managed model data");
    const array = Array.isArray(input);
    if (
      !array && Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) throw new TypeError("Invalid managed model data");
    ancestors.add(input);
    const output: Record<string, unknown> | unknown[] = array ? [] : {};
    const keys = Reflect.ownKeys(input);
    if (keys.length > 100_000) throw new TypeError("Invalid managed model data");
    // First-party provider snapshots pin an inert own toJSON value on arrays.
    // Copy only their indexed data; never invoke or transport a serialization hook.
    const guard = array ? Object.getOwnPropertyDescriptor(input, "toJSON") : undefined;
    const guardedArray = guard !== undefined && "value" in guard && guard.value === undefined &&
      guard.enumerable === false && guard.configurable === false && guard.writable === false;
    if (
      array && (keys.length !== input.length + 1 + (guardedArray ? 1 : 0) || input.length > 100_000)
    ) {
      throw new TypeError("Invalid managed model data");
    }
    for (const key of keys) {
      if (array && key === "length") continue;
      if (guardedArray && key === "toJSON") continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        typeof key !== "string" || !descriptor || !("value" in descriptor) || !descriptor.enumerable
      ) throw new TypeError("Invalid managed model data");
      if (!array && descriptor.value === undefined) continue;
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(input);
    return output;
  }
  const snapshot = snapshotBoundedJsonValue(copy(value, 0));
  if (!snapshot.success) throw new TypeError("Invalid managed model data");
  return snapshot.value;
}
