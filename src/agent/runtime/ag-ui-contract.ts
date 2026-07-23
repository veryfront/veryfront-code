import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { parseAgUiJsonBody, parseAgUiJsonRequestOrError } from "../ag-ui/request-shared.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
const MAX_RUNTIME_MESSAGES = 100;

const encoder = new TextEncoder();

/** Tool definition supplied with a canonical runtime AG-UI request. */
export interface AgUiRuntimeInjectedTool {
  /** Tool name. */
  name: string;
  /** Optional tool description. */
  description?: string;
  /** Legacy JSON Schema parameters document. */
  parameters?: Record<string, unknown>;
  /** JSON Schema document for tool input. */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema document for tool output. */
  outputSchema?: Record<string, unknown>;
}

/** Context item supplied with a canonical runtime AG-UI request. */
export type AgUiRuntimeContextItem =
  | {
    /** Text context discriminator. */
    type: "text";
    /** Optional context title. */
    title?: string;
    /** Text context payload. */
    text: string;
  }
  | {
    /** JSON context discriminator. */
    type: "json";
    /** Optional context title. */
    title?: string;
    /** Structured context payload. */
    data: Record<string, unknown>;
  }
  | {
    /** Resource context discriminator. */
    type: "resource";
    /** Optional context title. */
    title?: string;
    /** Resource URI. */
    uri: string;
    /** Optional resource media type. */
    mimeType?: string;
    /** Optional inline resource text. */
    text?: string;
  };

/** Message accepted by the canonical runtime AG-UI request. */
export type AgUiRuntimeMessage =
  | {
    /** Message identifier. */
    id: string;
    /** System-message discriminator. */
    role: "system";
    /** System-message content. */
    content: string;
    /** Optional sender name. */
    name?: string;
    /** Optional message metadata. */
    metadata?: Record<string, unknown>;
    /** Optional creation timestamp. */
    createdAt?: string;
  }
  | {
    /** Message identifier. */
    id: string;
    /** User-message discriminator. */
    role: "user";
    /** User-message content. */
    content: string;
    /** Optional sender name. */
    name?: string;
    /** Optional message metadata. */
    metadata?: Record<string, unknown>;
    /** Optional creation timestamp. */
    createdAt?: string;
  }
  | {
    /** Message identifier. */
    id: string;
    /** Assistant-message discriminator. */
    role: "assistant";
    /** Optional assistant text content. */
    content?: string;
    /** Tool calls requested by the assistant. */
    toolCalls?: Array<{
      /** Tool-call identifier. */
      id: string;
      /** Tool-call discriminator. */
      type: "function";
      /** Serialized function call. */
      function: {
        /** Tool name. */
        name: string;
        /** JSON-encoded tool arguments. */
        arguments: string;
      };
    }>;
    /** Optional sender name. */
    name?: string;
    /** Optional message metadata. */
    metadata?: Record<string, unknown>;
    /** Optional creation timestamp. */
    createdAt?: string;
  }
  | {
    /** Message identifier. */
    id: string;
    /** Tool-message discriminator. */
    role: "tool";
    /** Tool call associated with the result. */
    toolCallId: string;
    /** Serialized tool result content. */
    content: string;
    /** Optional tool execution error. */
    error?: string;
    /** Optional sender name. */
    name?: string;
    /** Optional message metadata. */
    metadata?: Record<string, unknown>;
    /** Optional creation timestamp. */
    createdAt?: string;
  };

/** Canonical request accepted by the runtime AG-UI handler. */
export interface AgUiRuntimeRequest {
  /** Conversation thread identifier. */
  threadId: string;
  /** Runtime run identifier. */
  runId: string;
  /** Optional parent run identifier. */
  parentRunId?: string;
  /** Optional runtime state snapshot. */
  state?: unknown;
  /** Conversation messages. */
  messages: AgUiRuntimeMessage[];
  /** Client-supplied tool definitions. */
  tools: AgUiRuntimeInjectedTool[];
  /** Context entries available to the run. */
  context: Array<
    | { description: string; value: string }
    | AgUiRuntimeContextItem
  >;
  /** Optional host-forwarded properties. */
  forwardedProps?: Record<string, unknown>;
}

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

/** Zod schema for get AG-UI runtime injected tool. */
export const getAgUiRuntimeInjectedToolSchema: () => Schema<AgUiRuntimeInjectedTool> = defineSchema(
  (v) =>
    v.object({
      name: agUiRuntimeInjectedToolNameSchema(v),
      description: v.string().max(1024).optional(),
      parameters: v.record(v.string(), v.unknown()).optional().refine(
        (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
        { message: "Tool parameters must be less than 16 KB" },
      ),
      inputSchema: agUiRuntimeToolJsonSchemaDocumentSchema(v).optional(),
      outputSchema: agUiRuntimeToolJsonSchemaDocumentSchema(v).optional(),
    }),
);

/** Zod schema for get AG-UI runtime context item. */
export const getAgUiRuntimeContextItemSchema: () => Schema<AgUiRuntimeContextItem> = defineSchema((
  v,
) =>
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

/** Zod schema for get AG-UI runtime message. */
export const getAgUiRuntimeMessageSchema: () => Schema<AgUiRuntimeMessage> = defineSchema((v) =>
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

/** Zod schema for get AG-UI runtime request. */
export const getAgUiRuntimeRequestSchema: () => Schema<AgUiRuntimeRequest> = defineSchema((v) =>
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
      { message: "forwardedProps must be less than 192 KB" },
    ),
  })
);

/** Request payload for normalize AG-UI browser runtime. */
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

/** Request payload for parse AG-UI runtime. */
export async function parseAgUiRuntimeRequest(request: Request): Promise<AgUiRuntimeRequest> {
  return getAgUiRuntimeRequestSchema().parse(await parseAgUiJsonBody(request));
}

/** Error shape for parse AG-UI runtime request or. */
export async function parseAgUiRuntimeRequestOrError(
  request: Request,
): Promise<AgUiRuntimeRequest | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseAgUiRuntimeRequest(request),
    "Invalid AG-UI runtime request",
  );
}
