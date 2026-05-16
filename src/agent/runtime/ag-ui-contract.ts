import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { parseAgUiJsonRequestOrError } from "../ag-ui/request-shared.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const MAX_RUNTIME_MESSAGES = 100;

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export const getAgUiRuntimeRunIdSchema = defineSchema((v) =>
  v.string().min(1).max(128).regex(AGENT_ID_PATTERN)
);

// Shape-helper: lifted from `AgUiRuntimeInjectedToolSchema.shape.name` so it
// can be reused inside `AgUiRuntimeToolFunctionCallSchema` without exposing
// `.shape` (not in the contract DSL).
const agUiRuntimeInjectedToolNameSchema = (v: SchemaValidator) =>
  v.string().min(1).max(128).regex(
    /^[a-zA-Z][a-zA-Z0-9._:-]*$/,
    "Tool names must start with a letter and use a valid client-tool format",
  );

const agUiRuntimeToolJsonSchemaDocumentSchema = (v: SchemaValidator) =>
  v.record(v.string(), v.unknown()).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool schema metadata must be less than 16 KB" },
  );

export const getAgUiRuntimeInjectedToolSchema = defineSchema((v) =>
  v.object({
    name: agUiRuntimeInjectedToolNameSchema(v),
    description: v.string().max(1024).optional(),
    parameters: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
      { message: "Tool parameters must be less than 16 KB" },
    ),
    inputSchema: agUiRuntimeToolJsonSchemaDocumentSchema(v).optional(),
    outputSchema: agUiRuntimeToolJsonSchemaDocumentSchema(v).optional(),
  })
);

export const getAgUiRuntimeContextItemSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("text"),
      title: v.string().max(256).optional(),
      text: v.string().max(MAX_CONTEXT_ITEM_BYTES),
    }),
    v.object({
      type: v.literal("json"),
      title: v.string().max(256).optional(),
      data: v.record(v.string(), v.unknown()).refine(
        (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
        { message: "JSON context item must be less than 16 KB" },
      ),
    }),
    v.object({
      type: v.literal("resource"),
      title: v.string().max(256).optional(),
      uri: v.string().max(2048),
      mimeType: v.string().max(256).optional(),
      text: v.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
    }),
  ])
);

const runtimeMessageExtensionFields = (v: SchemaValidator) => ({
  name: v.string().max(256).optional(),
  metadata: v.record(v.string(), v.unknown()).optional(),
  createdAt: v.string().optional(),
});

export const getAgUiRuntimeToolFunctionCallSchema = defineSchema((v) =>
  v.object({
    name: agUiRuntimeInjectedToolNameSchema(v),
    arguments: v.string().max(MAX_TOOL_PARAMETERS_BYTES),
  }).strict()
);

export const getAgUiRuntimeToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(128),
    type: v.literal("function"),
    function: getAgUiRuntimeToolFunctionCallSchema(),
  }).strict()
);

export const getAgUiRuntimeSystemMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.literal("system"),
    content: v.string(),
    ...runtimeMessageExtensionFields(v),
  }).strict()
);

export const getAgUiRuntimeUserMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.literal("user"),
    content: v.string(),
    ...runtimeMessageExtensionFields(v),
  }).strict()
);

export const getAgUiRuntimeAssistantMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.literal("assistant"),
    content: v.string().optional(),
    toolCalls: v.array(getAgUiRuntimeToolCallSchema()).optional(),
    ...runtimeMessageExtensionFields(v),
  }).strict()
);

export const getAgUiRuntimeToolMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.literal("tool"),
    toolCallId: v.string().min(1).max(128),
    content: v.string(),
    error: v.string().optional(),
    ...runtimeMessageExtensionFields(v),
  }).strict()
);

export const getAgUiRuntimeMessageSchema = defineSchema((v) =>
  v.discriminatedUnion("role", [
    getAgUiRuntimeSystemMessageSchema(),
    getAgUiRuntimeUserMessageSchema(),
    getAgUiRuntimeAssistantMessageSchema(),
    getAgUiRuntimeToolMessageSchema(),
  ])
);

export const getAgUiRuntimeContextSchema = defineSchema((v) =>
  v.union([
    v.object({
      description: v.string().max(1024),
      value: v.string().max(MAX_CONTEXT_ITEM_BYTES),
    }),
    getAgUiRuntimeContextItemSchema(),
  ])
);

export const getAgUiRuntimeRequestSchema = defineSchema((v) =>
  v.object({
    threadId: v.string().uuid(),
    runId: getAgUiRuntimeRunIdSchema(),
    parentRunId: getAgUiRuntimeRunIdSchema().optional(),
    state: v.unknown().optional(),
    messages: v.array(getAgUiRuntimeMessageSchema()).max(MAX_RUNTIME_MESSAGES),
    tools: v.array(getAgUiRuntimeInjectedToolSchema()).max(50).default([]),
    context: v.array(getAgUiRuntimeContextSchema()).max(10).default([]).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
      { message: "context must be less than 64 KB total" },
    ),
    forwardedProps: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
      { message: "forwardedProps must be less than 64 KB" },
    ),
  })
);

export type AgUiRuntimeInjectedTool = InferSchema<
  ReturnType<typeof getAgUiRuntimeInjectedToolSchema>
>;
export type AgUiRuntimeContextItem = InferSchema<
  ReturnType<typeof getAgUiRuntimeContextItemSchema>
>;
export type AgUiRuntimeMessage = InferSchema<ReturnType<typeof getAgUiRuntimeMessageSchema>>;
export type AgUiRuntimeRequest = InferSchema<ReturnType<typeof getAgUiRuntimeRequestSchema>>;

export function normalizeAgUiBrowserRuntimeRequest(
  input: AgUiRuntimeRequest,
  defaults?: {
    threadId?: string;
    runId?: string;
  },
): AgUiRuntimeRequest {
  const { state, ...rest } = input;

  // Preserve the original behaviour: omit the `state` key entirely when the
  // value is not a plain object. The contract DSL's strict object shape sees
  // `state` as a required key (value `unknown | undefined`), so cast the
  // return literal to satisfy the type-checker while keeping runtime semantics
  // identical to the pre-migration schema.
  return {
    ...rest,
    threadId: defaults?.threadId ?? input.threadId,
    runId: defaults?.runId ?? input.runId,
    messages: input.messages,
    ...(isRecord(state) ? { state } : {}),
  } as AgUiRuntimeRequest;
}

export async function parseAgUiRuntimeRequest(request: Request): Promise<AgUiRuntimeRequest> {
  return getAgUiRuntimeRequestSchema().parse(await request.json());
}

export async function parseAgUiRuntimeRequestOrError(
  request: Request,
): Promise<AgUiRuntimeRequest | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseAgUiRuntimeRequest(request),
    "Invalid AG-UI runtime request",
  );
}
