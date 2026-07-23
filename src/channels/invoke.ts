import type { AgentMessage as Message, AgentResponse } from "#veryfront/agent";
import { fromError } from "#veryfront/errors";
import type { HandlerContext as ServerHandlerContext } from "#veryfront/types";
import { serverLogger } from "#veryfront/utils";
import { defineSchema, getJsonValueSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import {
  getAgent as getRegisteredAgent,
  getAllAgentIds as getRegisteredAgentIds,
} from "../agent/composition/composition.ts";
import {
  type ChannelRequestContext,
  listRuntimeAgents,
  type RuntimeAgentDiscoveryDeps,
  type RuntimeAgentMetadataSource,
} from "./control-plane.ts";
import {
  readDataProperty,
  readOwnDataProperty,
  snapshotDenseArray,
  snapshotJsonValue,
} from "./snapshot.ts";
import { ensureProjectDiscovery as ensureProjectDiscoveryForProject } from "#veryfront/server/handlers/request/api/project-discovery.ts";

export type {
  AgentMessage,
  AgentResponse,
  AgentResponseUsage,
  AgentStatus,
  MessagePart,
  ToolCall,
  ToolCallPart,
  ToolCallPartWithArgs,
  ToolCallPartWithInput,
  ToolResultPart,
} from "#veryfront/agent";
export type {
  InferSchema,
  InferShape,
  RefinementCtx,
  Schema,
  ValidationFailure,
  ValidationIssue,
  ValidationResult,
  ValidationSuccess,
} from "#veryfront/extensions/schema/index.ts";
export type { JsonValue } from "#veryfront/schemas/index.ts";
export type {
  ChannelDiscoveryContext,
  ChannelRequestContext,
  DispatchClaims,
  LegacyChannelRequestContext,
  RuntimeAgentDiscoveryDeps,
  RuntimeAgentMetadataSource,
  SupportedChannelRequestContext,
} from "./control-plane.ts";

const logger = serverLogger.component("channels-invoke");
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_USER_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_FILENAME_LENGTH = 512;
const MAX_MEDIA_TYPE_LENGTH = 256;
const MAX_MODEL_IDENTIFIER_LENGTH = 256;
const MAX_PRIVATE_URL_LENGTH = 8_192;
const MAX_INBOUND_TEXT_LENGTH = 32_768;
const MAX_HISTORY_TEXT_LENGTH = 10_000;
const MAX_HISTORY_MESSAGES = 100;
const MAX_PARTS_PER_MESSAGE = 100;
const MAX_ATTACHMENTS = 20;
const MAX_METADATA_BYTES = 16_384;
const MAX_PART_BYTES = 65_536;
const MAX_RESPONSE_TEXT_LENGTH = 65_536;
const MAX_RESPONSE_PARTS = 256;
const MAX_CHANNEL_ASSISTANTS = 1_000;
const MAX_RESPONSE_TOKENS = 16_384;
const MAX_CHANNEL_REQUEST_BYTES = 128 * 1_024;
const MAX_CHANNEL_RESPONSE_BYTES = 128 * 1_024;
const encoder = new TextEncoder();
const jsonValueSchema: Schema<JsonValue> = lazySchema(getJsonValueSchema);

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" && encoder.encode(serialized).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

function isSafeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function isValidWireIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function getOwnDataValue(input: unknown, key: PropertyKey): unknown {
  const property = readOwnDataProperty(input, key);
  if (!property.ok || !property.present) {
    throw new TypeError(`Channel runtime value is missing a safe ${String(key)} property`);
  }
  return property.value;
}

function getOptionalOwnDataValue(input: unknown, key: PropertyKey): unknown {
  const property = readOwnDataProperty(input, key);
  if (!property.ok) {
    throw new TypeError(`Channel runtime value has an unsafe ${String(key)} property`);
  }
  return property.present ? property.value : undefined;
}

function snapshotChannelJson(value: unknown, label: string): JsonValue {
  const snapshot = snapshotJsonValue(value);
  if (!snapshot.ok) throw new TypeError(`${label} must be bounded JSON data`);
  return snapshot.value;
}

/** Attachment delivered with a channel message. */
export interface ChannelAttachment {
  /** Attachment identifier. */
  id: string;
  /** Attachment kind. */
  kind: "image" | "file";
  /** Optional source filename. */
  filename?: string;
  /** Optional media type. */
  mediaType?: string;
  /** Optional private attachment URL. */
  privateUrl?: string;
}

/** Persisted message part accepted by the channel compatibility wire format. */
export interface ChannelInvokeHistoryPart {
  /** Message-part discriminator. */
  type: string;
  /** Compatibility fields carried by the persisted part. */
  [key: string]: unknown;
}

/** Persisted conversation message accepted by a channel invoke. */
export interface ChannelInvokeHistoryMessage {
  /** Message identifier. */
  id: string;
  /** Message role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Ordered message parts. */
  parts: ChannelInvokeHistoryPart[];
  /** Optional JSON metadata. */
  metadata?: Record<string, JsonValue>;
  /** Optional ISO creation timestamp. */
  createdAt?: string;
}

/** Signed request payload for a channel agent invocation. */
export interface ChannelInvokeRequest {
  /** Dispatch identifier bound to the signature subject. */
  dispatchId: string;
  /** Conversation identifier. */
  conversationId: string;
  /** Project identifier. */
  projectId: string;
  /** Runtime agent identifier. */
  assistantId: string;
  /** Source channel platform. */
  platform: "slack";
  /** Inbound channel message. */
  inboundMessage: {
    /** Message text. */
    text: string;
    /** Sender identifier. */
    userId: string;
    /** Sender display name. */
    userName: string;
    /** Whether the message came from a direct conversation. */
    isDirectMessage: boolean;
    /** Optional attachments. */
    attachments?: ChannelAttachment[];
  };
  /** Complete persisted conversation history for the invocation. */
  conversationHistory: ChannelInvokeHistoryMessage[];
  /** Optional generation controls. */
  generation?: {
    /** Maximum output-token count. */
    maxResponseTokens?: number;
  };
}

/** Request payload for listing channel assistants. */
export interface ChannelAssistantsRequest {
  /** Unique request identifier. */
  requestId: string;
  /** Project identifier. */
  projectId: string;
  /** Source channel platform. */
  platform: "slack";
}

/** Agent metadata exposed to a channel integration. */
export interface ChannelAssistant {
  /** Runtime agent identifier. */
  id: string;
  /** Human-readable agent name. */
  name: string;
  /** Optional agent description. */
  description?: string | null;
  /** Optional model identifier. */
  model?: string | null;
}

/** Response returned when listing channel assistants. */
export interface ChannelAssistantsResponse {
  /** Available channel assistants. */
  assistants: ChannelAssistant[];
}

/** One part of a channel invoke response. */
export type ChannelResponsePart =
  | { type: "text"; text: string }
  | {
    type: "tool_call";
    id: string;
    name: string;
    input: Record<string, JsonValue>;
    state: "streaming" | "pending" | "completed" | "error";
  }
  | {
    type: "tool_result";
    tool_call_id: string;
    output: JsonValue;
    is_error?: boolean;
  }
  | { type: "reasoning"; text: string }
  | { type: "error"; code: string; message: string };

/** Response returned by a channel agent invocation. */
export interface ChannelInvokeResponse {
  /** Whether the invocation was intentionally ignored. */
  ignored: boolean;
  /** Optional ordered response parts. */
  responseParts?: ChannelResponsePart[];
  /** Optional token accounting. */
  tokenUsage?: {
    /** Input tokens. */
    inputTokens?: number;
    /** Output tokens. */
    outputTokens?: number;
    /** Total tokens. */
    totalTokens?: number;
    /** Cached input tokens. */
    cachedInputTokens?: number;
    /** Cache-creation input tokens. */
    cacheCreationInputTokens?: number;
    /** Cache-read input tokens. */
    cacheReadInputTokens?: number;
    /** Reasoning tokens. */
    reasoningTokens?: number;
  };
  /** Sanitized invocation failure. */
  error?: {
    /** Stable error category. */
    code: "provider_error" | "internal_error";
    /** Whether a caller can safely retry. */
    retryable: boolean;
  };
}

/** Optional execution controls for a channel invocation. */
export interface ChannelInvokeExecutionOptions {
  /** Cooperative cancellation from the inbound request. */
  signal?: AbortSignal;
}

const getRawHistoryPartSchema: () => Schema<ChannelInvokeHistoryPart> = defineSchema((v) =>
  v.object({
    type: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  }).passthrough().refine(
    (part) =>
      isWithinJsonSizeLimit(part, MAX_PART_BYTES) &&
      (part.type !== "text" ||
        (typeof part.text === "string" && part.text.length <= MAX_HISTORY_TEXT_LENGTH)),
    { message: "Channel history part exceeds the supported limit" },
  )
);
const _rawHistoryPartSchema: Schema<ChannelInvokeHistoryPart> = lazySchema(
  getRawHistoryPartSchema,
);

const getChannelAttachmentSchema: () => Schema<ChannelAttachment> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    kind: v.enum(["image", "file"] as const),
    filename: v.string().max(MAX_FILENAME_LENGTH).optional(),
    mediaType: v.string().max(MAX_MEDIA_TYPE_LENGTH).optional(),
    privateUrl: v.string().url().max(MAX_PRIVATE_URL_LENGTH).refine(isSafeRemoteUrl, {
      message: "Channel attachment URL must use HTTP or HTTPS without credentials",
    }).optional(),
  }).strip()
);

const getChannelInvokeHistoryMessageSchema: () => Schema<ChannelInvokeHistoryMessage> =
  defineSchema((v) =>
    v.object({
      id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      role: v.enum(["user", "assistant", "system", "tool"] as const),
      parts: v.array(getRawHistoryPartSchema()).max(MAX_PARTS_PER_MESSAGE),
      metadata: v.record(v.string(), getJsonValueSchema()).optional().refine(
        (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_METADATA_BYTES),
        { message: "Channel message metadata exceeds the supported limit" },
      ),
      createdAt: v.string().max(64).datetime().optional(),
    }).strip()
  );

const getChannelInvokeRequestWireSchema: () => Schema<ChannelInvokeRequest> = defineSchema((v) =>
  v.object({
    dispatchId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    conversationId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    projectId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    assistantId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    platform: v.literal("slack"),
    inboundMessage: v.object({
      text: v.string().max(MAX_INBOUND_TEXT_LENGTH),
      userId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      userName: v.string().max(MAX_USER_NAME_LENGTH),
      isDirectMessage: v.boolean(),
      attachments: v.array(getChannelAttachmentSchema()).max(MAX_ATTACHMENTS).optional(),
    }).strip(),
    conversationHistory: v.array(getChannelInvokeHistoryMessageSchema()).max(MAX_HISTORY_MESSAGES),
    generation: v.object({
      maxResponseTokens: v.number().int().positive().max(MAX_RESPONSE_TOKENS).optional(),
    }).strip().optional(),
  }).strip().refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CHANNEL_REQUEST_BYTES),
    { message: "Channel invoke request exceeds the supported limit" },
  )
);

/** Zod schema for get channel invoke request. */
export const getChannelInvokeRequestSchema: () => Schema<ChannelInvokeRequest> =
  getChannelInvokeRequestWireSchema;
/** Zod schema for channel invoke request. */
export const ChannelInvokeRequestSchema: Schema<ChannelInvokeRequest> = lazySchema(
  getChannelInvokeRequestSchema,
);

/** Zod schema for get channel assistants request. */
export const getChannelAssistantsRequestSchema: () => Schema<ChannelAssistantsRequest> =
  defineSchema((v) =>
    v.object({
      requestId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      projectId: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      platform: v.literal("slack"),
    }).strip()
  );
/** Zod schema for channel assistants request. */
export const ChannelAssistantsRequestSchema: Schema<ChannelAssistantsRequest> = lazySchema(
  getChannelAssistantsRequestSchema,
);

/** Zod schema for get channel assistant. */
export const getChannelAssistantSchema: () => Schema<ChannelAssistant> = defineSchema((v) =>
  v.object({
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    name: v.string().min(1).max(MAX_USER_NAME_LENGTH),
    description: v.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
    model: v.string().max(MAX_MODEL_IDENTIFIER_LENGTH).nullable().optional(),
  }).strip()
);
/** Zod schema for channel assistant. */
export const ChannelAssistantSchema: Schema<ChannelAssistant> = lazySchema(
  getChannelAssistantSchema,
);

/** Zod schema for get channel assistants response. */
export const getChannelAssistantsResponseSchema: () => Schema<ChannelAssistantsResponse> =
  defineSchema((v) =>
    v.object({
      assistants: v.array(getChannelAssistantSchema()).max(MAX_CHANNEL_ASSISTANTS),
    }).strip()
  );
/** Zod schema for channel assistants response. */
export const ChannelAssistantsResponseSchema: Schema<ChannelAssistantsResponse> = lazySchema(
  getChannelAssistantsResponseSchema,
);

const getChannelTextPartSchema = defineSchema<Extract<ChannelResponsePart, { type: "text" }>>((v) =>
  v.object({
    type: v.literal("text"),
    text: v.string().max(MAX_RESPONSE_TEXT_LENGTH),
  }).strip()
);
const channelTextPartSchema: Schema<Extract<ChannelResponsePart, { type: "text" }>> = lazySchema(
  getChannelTextPartSchema,
);

const getChannelToolCallPartSchema = defineSchema<
  Extract<ChannelResponsePart, { type: "tool_call" }>
>((v) =>
  v.object({
    type: v.literal("tool_call"),
    id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    name: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    input: v.record(v.string(), getJsonValueSchema()).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_PART_BYTES),
      { message: "Channel tool input exceeds the supported limit" },
    ),
    state: v.enum(["streaming", "pending", "completed", "error"] as const),
  }).strip()
);
const channelToolCallPartSchema: Schema<Extract<ChannelResponsePart, { type: "tool_call" }>> =
  lazySchema(getChannelToolCallPartSchema);

const getChannelToolResultPartSchema = defineSchema<
  Extract<ChannelResponsePart, { type: "tool_result" }>
>((v) =>
  v.object({
    type: v.literal("tool_result"),
    tool_call_id: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
    output: getJsonValueSchema().refine(
      (value) => isWithinJsonSizeLimit(value, MAX_PART_BYTES),
      { message: "Channel tool output exceeds the supported limit" },
    ),
    is_error: v.boolean().optional(),
  }).strip()
);
const channelToolResultPartSchema: Schema<Extract<ChannelResponsePart, { type: "tool_result" }>> =
  lazySchema(getChannelToolResultPartSchema);

const getChannelReasoningPartSchema = defineSchema<
  Extract<ChannelResponsePart, { type: "reasoning" }>
>((v) =>
  v.object({
    type: v.literal("reasoning"),
    text: v.string().max(MAX_RESPONSE_TEXT_LENGTH),
  }).strip()
);
const channelReasoningPartSchema: Schema<Extract<ChannelResponsePart, { type: "reasoning" }>> =
  lazySchema(getChannelReasoningPartSchema);

const getChannelErrorPartSchema = defineSchema<Extract<ChannelResponsePart, { type: "error" }>>(
  (v) =>
    v.object({
      type: v.literal("error"),
      code: v.string().min(1).max(MAX_IDENTIFIER_LENGTH),
      message: v.string().max(MAX_ERROR_MESSAGE_LENGTH),
    }).strip(),
);
const _channelErrorPartSchema: Schema<Extract<ChannelResponsePart, { type: "error" }>> = lazySchema(
  getChannelErrorPartSchema,
);

/** Zod schema for get channel response part. */
export const getChannelResponsePartSchema: () => Schema<ChannelResponsePart> = defineSchema((v) =>
  v.discriminatedUnion("type", [
    getChannelTextPartSchema(),
    getChannelToolCallPartSchema(),
    getChannelToolResultPartSchema(),
    getChannelReasoningPartSchema(),
    getChannelErrorPartSchema(),
  ])
);
/** Zod schema for channel response part. */
export const ChannelResponsePartSchema: Schema<ChannelResponsePart> = lazySchema(
  getChannelResponsePartSchema,
);

/** Zod schema for get channel invoke response. */
export const getChannelInvokeResponseSchema: () => Schema<ChannelInvokeResponse> = defineSchema((
  v,
) =>
  v.object({
    ignored: v.boolean(),
    responseParts: v.array(getChannelResponsePartSchema()).max(MAX_RESPONSE_PARTS).optional(),
    tokenUsage: v.object({
      inputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      outputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      totalTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      cachedInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      cacheCreationInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
        .optional(),
      cacheReadInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      reasoningTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    }).strip().optional(),
    error: v.object({
      code: v.enum(["provider_error", "internal_error"] as const),
      retryable: v.boolean(),
    }).strip().optional(),
  }).strip()
    .refine(
      (value) =>
        value.error === undefined ||
        value.responseParts === undefined && value.tokenUsage === undefined,
      { message: "Channel response cannot contain both success data and an error" },
    )
    .refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CHANNEL_RESPONSE_BYTES),
      { message: "Channel response exceeds the supported limit" },
    )
);
/** Zod schema for channel invoke response. */
export const ChannelInvokeResponseSchema: Schema<ChannelInvokeResponse> = lazySchema(
  getChannelInvokeResponseSchema,
);

/** Public API contract for channel invoke deps. */
export interface ChannelInvokeDeps<
  TContext extends ChannelRequestContext = ChannelRequestContext,
> extends RuntimeAgentDiscoveryDeps<TContext> {
  /** Resolve an invocable runtime agent by identifier. */
  getAgent: (id: string) => ChannelInvocableAgent | undefined;
}

/** Input accepted by an agent invoked through a channel dispatch. */
export interface ChannelAgentGenerateInput {
  /** Normalized conversation history. */
  input: string | Message[];
  /** Request-scoped agent context. */
  context?: Record<string, unknown>;
  /** Maximum output-token count. */
  maxOutputTokens?: number;
  /** Cooperative cancellation from the inbound request. */
  abortSignal?: AbortSignal;
  /** Memory behavior for the invocation. */
  memoryMode?: "configured" | "isolated";
}

/** Narrow agent contract required by channel invocation. */
export interface ChannelInvocableAgent extends RuntimeAgentMetadataSource {
  /** Generate a response for one channel request. */
  generate(input: ChannelAgentGenerateInput): Promise<AgentResponse>;
}

function getDiscoveryCapability(
  ctx: ChannelRequestContext,
): ((this: ChannelRequestContext) => Promise<unknown>) | undefined {
  const capability = readDataProperty(ctx, "ensureProjectDiscovery");
  return capability.ok && capability.present && typeof capability.value === "function"
    ? capability.value as (this: ChannelRequestContext) => Promise<unknown>
    : undefined;
}

function hasLegacyChannelRequestShape(ctx: ChannelRequestContext): boolean {
  const projectDir = readDataProperty(ctx, "projectDir");
  const adapter = readDataProperty(ctx, "adapter");
  if (
    !projectDir.ok || !projectDir.present || typeof projectDir.value !== "string" ||
    projectDir.value.length === 0 || !adapter.ok || !adapter.present ||
    typeof adapter.value !== "object" || adapter.value === null || Array.isArray(adapter.value)
  ) {
    return false;
  }
  const fs = readDataProperty(adapter.value, "fs");
  return fs.ok && fs.present;
}

async function ensureDefaultChannelProjectDiscovery(
  ctx: ChannelRequestContext,
): Promise<unknown> {
  const discoveryCapability = getDiscoveryCapability(ctx);
  if (discoveryCapability) {
    return await discoveryCapability.call(ctx);
  }
  if (!hasLegacyChannelRequestShape(ctx)) {
    throw new TypeError("Channel request context does not support project discovery");
  }

  // HandlerContext remains an implementation detail of this compatibility
  // adapter. The public channels contract exposes only the fields it requires.
  return await ensureProjectDiscoveryForProject(ctx as ServerHandlerContext);
}

/** Shared default channel invoke deps value. */
export const defaultChannelInvokeDeps: ChannelInvokeDeps = {
  ensureProjectDiscovery: ensureDefaultChannelProjectDiscovery,
  getAgent: getRegisteredAgent,
  getAllAgentIds: getRegisteredAgentIds,
};

/** List channel assistants. */
export async function listChannelAssistants<TContext extends ChannelRequestContext>(
  ctx: TContext,
  deps: ChannelInvokeDeps<TContext>,
): Promise<ChannelAssistantsResponse> {
  const response = await listRuntimeAgents(ctx, deps);
  const assistants = response.agents.map((agent) =>
    ChannelAssistantSchema.parse({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? null,
      model: agent.model ?? null,
    })
  );

  return ChannelAssistantsResponseSchema.parse({ assistants });
}
export {
  verifyControlPlaneJwsSignature,
  verifyDispatchJws,
  verifyDispatchJwsSignature,
} from "./control-plane.ts";

function normalizeConversationPart(
  part: unknown,
  toolNamesById: ReadonlyMap<string, string> = new Map(),
): Message["parts"][number] | null {
  const type = getOwnDataValue(part, "type");
  if (type === "text") {
    const text = getOptionalOwnDataValue(part, "text");
    return typeof text === "string" && text.length <= MAX_HISTORY_TEXT_LENGTH
      ? { type: "text", text }
      : null;
  }

  if (type === "tool_call") {
    const id = getOptionalOwnDataValue(part, "id");
    const name = getOptionalOwnDataValue(part, "name");
    const rawInput = getOptionalOwnDataValue(part, "input");
    if (
      !isValidWireIdentifier(id) || !isValidWireIdentifier(name) ||
      !rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)
    ) return null;

    const inputSnapshot = snapshotJsonValue(rawInput);
    if (!inputSnapshot.ok) return null;
    const parsedInput = jsonValueSchema.safeParse(inputSnapshot.value);
    if (
      !parsedInput.success || !parsedInput.data || Array.isArray(parsedInput.data) ||
      !isWithinJsonSizeLimit(parsedInput.data, MAX_PART_BYTES)
    ) return null;

    return {
      type: `tool-${name}`,
      toolCallId: id,
      toolName: name,
      args: parsedInput.data as Record<string, unknown>,
    };
  }

  if (type === "tool_result") {
    const toolCallId = getOptionalOwnDataValue(part, "tool_call_id");
    if (!isValidWireIdentifier(toolCallId)) return null;
    const toolName = toolNamesById.get(toolCallId);
    const persistedToolName = getOptionalOwnDataValue(part, "tool_name");
    if (
      !toolName ||
      persistedToolName !== undefined &&
        (!isValidWireIdentifier(persistedToolName) || persistedToolName !== toolName)
    ) return null;

    const rawOutput = getOptionalOwnDataValue(part, "output");
    const outputSnapshot = rawOutput === undefined ? null : snapshotJsonValue(rawOutput);
    if (outputSnapshot && !outputSnapshot.ok) return null;
    const parsedOutput = outputSnapshot ? jsonValueSchema.safeParse(outputSnapshot.value) : null;
    if (
      parsedOutput &&
      (!parsedOutput.success || !isWithinJsonSizeLimit(parsedOutput.data, MAX_PART_BYTES))
    ) return null;

    return {
      type: "tool-result",
      toolCallId,
      toolName,
      result: parsedOutput?.data,
    };
  }

  return null;
}

/** Normalizes conversation history for runtime. */
export function normalizeConversationHistoryForRuntime(
  messages: ChannelInvokeRequest["conversationHistory"],
): Message[] {
  const messageSnapshot = snapshotDenseArray<unknown>(messages, MAX_HISTORY_MESSAGES);
  if (!messageSnapshot.ok) {
    throw new TypeError("Channel conversation history must be a bounded dense array");
  }
  const toolNamesById = new Map<string, string>();

  return messageSnapshot.value.map((message): Message => {
    const id = getOwnDataValue(message, "id");
    const role = getOwnDataValue(message, "role");
    if (
      !isValidWireIdentifier(id) ||
      role !== "user" && role !== "assistant" && role !== "system" && role !== "tool"
    ) {
      throw new TypeError("Channel conversation history message is invalid");
    }
    if (role === "user" || role === "system") {
      toolNamesById.clear();
    }

    const rawParts = snapshotDenseArray<unknown>(
      getOwnDataValue(message, "parts"),
      MAX_PARTS_PER_MESSAGE,
    );
    if (!rawParts.ok) {
      throw new TypeError("Channel conversation message parts must be a bounded dense array");
    }
    const parts = rawParts.value
      .map((part) => {
        const normalizedPart = normalizeConversationPart(part, toolNamesById);
        if (
          normalizedPart?.type !== "tool-result" && normalizedPart && "toolCallId" in normalizedPart
        ) {
          if (toolNamesById.has(normalizedPart.toolCallId)) return null;
          toolNamesById.set(normalizedPart.toolCallId, normalizedPart.toolName);
        }
        return normalizedPart;
      })
      .filter((part): part is NonNullable<typeof part> => part !== null);

    const createdAt = getOptionalOwnDataValue(message, "createdAt");
    if (createdAt !== undefined && typeof createdAt !== "string") {
      throw new TypeError("Channel conversation timestamp is invalid");
    }
    const timestamp = createdAt === undefined ? undefined : Date.parse(createdAt);
    if (timestamp !== undefined && !Number.isFinite(timestamp)) {
      throw new TypeError("Channel conversation timestamp is invalid");
    }
    const rawMetadata = getOptionalOwnDataValue(message, "metadata");
    const metadata = rawMetadata === undefined
      ? undefined
      : snapshotChannelJson(rawMetadata, "Channel conversation metadata");
    if (
      metadata !== undefined &&
      (typeof metadata !== "object" || metadata === null || Array.isArray(metadata) ||
        !isWithinJsonSizeLimit(metadata, MAX_METADATA_BYTES))
    ) {
      throw new TypeError("Channel conversation metadata must be a JSON object");
    }
    return {
      id,
      role,
      parts,
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(metadata === undefined ? {} : { metadata: metadata as Record<string, unknown> }),
    };
  });
}

/** Resolves channel invoke agent. */
export function resolveChannelInvokeAgent<TAgent extends ChannelInvocableAgent>(
  assistantId: string,
  deps: { getAgent: (id: string) => TAgent | undefined },
): TAgent | undefined {
  return deps.getAgent(assistantId);
}

function toChannelToolCallState(
  status: unknown,
): "streaming" | "pending" | "completed" | "error" {
  switch (status) {
    case "pending":
      return "pending";
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "executing":
      return "streaming";
    default:
      throw new TypeError("Agent response contains an invalid tool call state");
  }
}

function convertAssistantPartToChannelResponsePart(
  part: unknown,
  knownToolCallIds: Set<string>,
): ChannelResponsePart | null {
  const type = getOwnDataValue(part, "type");
  if (type === "text") {
    return channelTextPartSchema.parse({
      type: "text",
      text: getOwnDataValue(part, "text"),
    });
  }

  // A tool-call part carries `toolCallId`; `tool-result` and any future
  // `tool-*` parts that aren't calls do not. The structural check guards
  // against misclassifying new `tool-*` part types as tool calls.
  if (typeof type !== "string") return null;
  const toolCallId = getOptionalOwnDataValue(part, "toolCallId");
  const isToolCallPart = type === "tool-call" ||
    type.startsWith("tool-") && type !== "tool-result";
  if (
    isToolCallPart &&
    isValidWireIdentifier(toolCallId) &&
    !knownToolCallIds.has(toolCallId)
  ) {
    const toolName = getOptionalOwnDataValue(part, "toolName");
    if (!isValidWireIdentifier(toolName)) return null;
    const args = getOptionalOwnDataValue(part, "args");
    const input = args === undefined ? getOptionalOwnDataValue(part, "input") : args;
    const inputSnapshot = snapshotChannelJson(input ?? {}, "Agent response tool input");
    if (
      typeof inputSnapshot !== "object" || inputSnapshot === null || Array.isArray(inputSnapshot)
    ) {
      throw new TypeError("Agent response tool input must be a JSON object");
    }
    return channelToolCallPartSchema.parse({
      type: "tool_call",
      id: toolCallId,
      name: toolName,
      input: inputSnapshot,
      state: "pending",
    });
  }

  return null;
}

function findLastAssistantMessage(messages: unknown[]): unknown | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (getOwnDataValue(message, "role") === "assistant") return message;
  }

  return undefined;
}

function appendChannelResponsePart(
  responseParts: ChannelResponsePart[],
  part: ChannelResponsePart,
): void {
  if (responseParts.length >= MAX_RESPONSE_PARTS) {
    throw new TypeError("Agent response exceeds the supported part limit");
  }
  responseParts.push(part);
}

/** Builds channel response parts. */
export function buildChannelResponseParts(response: AgentResponse): ChannelResponsePart[] {
  const responseParts: ChannelResponsePart[] = [];
  const knownToolCallIds = new Set<string>();
  const text = getOwnDataValue(response, "text");
  const thinking = getOptionalOwnDataValue(response, "thinking");
  if (typeof text !== "string" || thinking !== undefined && typeof thinking !== "string") {
    throw new TypeError("Agent response text fields are invalid");
  }

  if (thinking?.trim()) {
    appendChannelResponsePart(
      responseParts,
      channelReasoningPartSchema.parse({
        type: "reasoning",
        text: thinking,
      }),
    );
  }

  const toolCalls = snapshotDenseArray<unknown>(
    getOwnDataValue(response, "toolCalls"),
    MAX_RESPONSE_PARTS,
  );
  if (!toolCalls.ok) {
    throw new TypeError("Agent response tool calls must be a bounded dense array");
  }
  for (const toolCall of toolCalls.value) {
    const id = getOwnDataValue(toolCall, "id");
    const name = getOwnDataValue(toolCall, "name");
    const status = getOwnDataValue(toolCall, "status");
    if (!isValidWireIdentifier(id) || !isValidWireIdentifier(name)) {
      throw new TypeError("Agent response contains an invalid tool call");
    }
    if (knownToolCallIds.has(id)) {
      throw new TypeError("Agent response contains duplicate tool call identifiers");
    }
    knownToolCallIds.add(id);
    const args = snapshotChannelJson(
      getOwnDataValue(toolCall, "args"),
      "Agent response tool input",
    );
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new TypeError("Agent response tool input must be a JSON object");
    }
    appendChannelResponsePart(
      responseParts,
      channelToolCallPartSchema.parse({
        type: "tool_call",
        id,
        name,
        input: args,
        state: toChannelToolCallState(status),
      }),
    );

    if (status === "completed" || status === "error") {
      const rawResult = status === "error" ? null : getOptionalOwnDataValue(toolCall, "result");
      const result = status === "error"
        ? { error: "Tool execution failed" }
        : snapshotChannelJson(rawResult ?? null, "Agent response tool output");
      appendChannelResponsePart(
        responseParts,
        channelToolResultPartSchema.parse({
          type: "tool_result",
          tool_call_id: id,
          output: result,
          ...(status === "error" ? { is_error: true } : {}),
        }),
      );
    }
  }

  const messages = snapshotDenseArray<unknown>(
    getOwnDataValue(response, "messages"),
    MAX_RESPONSE_PARTS,
  );
  if (!messages.ok) {
    throw new TypeError("Agent response messages must be a bounded dense array");
  }
  const lastAssistantMessage = findLastAssistantMessage(messages.value);
  if (lastAssistantMessage) {
    const parts = snapshotDenseArray<unknown>(
      getOwnDataValue(lastAssistantMessage, "parts"),
      MAX_RESPONSE_PARTS,
    );
    if (!parts.ok) {
      throw new TypeError("Agent response message parts must be a bounded dense array");
    }
    for (const part of parts.value) {
      const converted = convertAssistantPartToChannelResponsePart(part, knownToolCallIds);
      if (converted) {
        if (converted.type === "tool_call") knownToolCallIds.add(converted.id);
        appendChannelResponsePart(responseParts, converted);
      }
    }
  }

  if (!responseParts.some((part) => part.type === "text") && text.trim()) {
    appendChannelResponsePart(
      responseParts,
      channelTextPartSchema.parse({
        type: "text",
        text,
      }),
    );
  }

  return responseParts;
}

function buildChannelTokenUsage(
  response: AgentResponse,
): ChannelInvokeResponse["tokenUsage"] {
  const usage = getOptionalOwnDataValue(response, "usage");
  if (usage === undefined) return undefined;
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) {
    throw new TypeError("Agent response usage is invalid");
  }

  const tokenUsage: NonNullable<ChannelInvokeResponse["tokenUsage"]> = {
    inputTokens: getOwnDataValue(usage, "promptTokens") as number,
    outputTokens: getOwnDataValue(usage, "completionTokens") as number,
    totalTokens: getOwnDataValue(usage, "totalTokens") as number,
  };
  const optionalFields = [
    ["cachedInputTokens", "cachedInputTokens"],
    ["cacheCreationInputTokens", "cacheCreationInputTokens"],
    ["cacheReadInputTokens", "cacheReadInputTokens"],
    ["reasoningTokens", "reasoningTokens"],
  ] as const;
  for (const [sourceKey, targetKey] of optionalFields) {
    const value = getOptionalOwnDataValue(usage, sourceKey);
    if (value !== undefined) tokenUsage[targetKey] = value as number;
  }
  return tokenUsage;
}

class ChannelResponseValidationError extends Error {
  constructor(cause: unknown) {
    super("Channel response validation failed", { cause });
    this.name = "ChannelResponseValidationError";
  }
}

function isChannelAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  try {
    return error instanceof DOMException && error.name === "AbortError" ||
      error instanceof Error && error.name === "AbortError";
  } catch {
    return false;
  }
}

function safeChannelErrorName(error: unknown, signal?: AbortSignal): string {
  if (isChannelAbortError(error, signal)) return "AbortError";
  try {
    if (error instanceof ChannelResponseValidationError) {
      return "ChannelResponseValidationError";
    }
    if (fromError(error)) return "VeryfrontError";
    if (error instanceof TypeError) return "TypeError";
    if (error instanceof SyntaxError) return "SyntaxError";
    if (error instanceof RangeError) return "RangeError";
    return error instanceof Error ? "Error" : "NonError";
  } catch {
    return "UnknownError";
  }
}

function classifyChannelInvokeError(
  error: unknown,
  signal?: AbortSignal,
): NonNullable<ChannelInvokeResponse["error"]> {
  if (isChannelAbortError(error, signal)) {
    return { code: "internal_error", retryable: false };
  }

  if (error instanceof ChannelResponseValidationError) {
    return { code: "internal_error", retryable: false };
  }

  if (error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError) {
    return { code: "internal_error", retryable: false };
  }

  const veryfrontError = fromError(error);

  if (veryfrontError?.type === "no_ai_available") {
    return { code: "provider_error", retryable: false };
  }

  if (veryfrontError?.type === "api" || veryfrontError?.type === "network") {
    return { code: "provider_error", retryable: true };
  }

  return { code: "internal_error", retryable: true };
}

/** Execute channel invoke. */
export async function executeChannelInvoke<TContext extends ChannelRequestContext>(
  inputPayload: ChannelInvokeRequest,
  ctx: TContext,
  deps: ChannelInvokeDeps<TContext>,
  options: ChannelInvokeExecutionOptions = {},
): Promise<ChannelInvokeResponse> {
  const signalProperty = readOwnDataProperty(options, "signal");
  const signal = signalProperty.ok && signalProperty.present ? signalProperty.value : undefined;
  if (!signalProperty.ok || signal !== undefined && !(signal instanceof AbortSignal)) {
    logger.error("Channel invoke execution options are invalid", {
      errorName: "ChannelInvokeOptionsValidationError",
    });
    return {
      ignored: false,
      error: { code: "internal_error", retryable: false },
    };
  }

  const inputSnapshot = snapshotJsonValue(inputPayload, { maxNodes: 50_000 });
  const parsedPayload = inputSnapshot.ok
    ? ChannelInvokeRequestSchema.safeParse(inputSnapshot.value)
    : null;
  if (!parsedPayload?.success) {
    logger.error("Channel invoke payload validation failed", {
      errorName: "ChannelInvokeRequestValidationError",
    });
    return {
      ignored: false,
      error: { code: "internal_error", retryable: false },
    };
  }
  const payload = parsedPayload.data;

  const projectIdProperty = readOwnDataProperty(ctx, "projectId");
  const runtimeProjectId = projectIdProperty.ok && projectIdProperty.present
    ? projectIdProperty.value
    : undefined;
  if (typeof runtimeProjectId !== "string" || payload.projectId !== runtimeProjectId) {
    logger.error("Channel invoke project binding failed", {
      errorName: "ProjectBindingError",
    });
    return {
      ignored: false,
      error: {
        code: "internal_error",
        retryable: false,
      },
    };
  }

  try {
    signal?.throwIfAborted();
    await deps.ensureProjectDiscovery(ctx);
  } catch (error) {
    const classified = classifyChannelInvokeError(error, signal);
    logger.error("Channel invoke discovery failed", {
      errorName: safeChannelErrorName(error, signal),
      errorCode: classified.code,
      retryable: classified.retryable,
    });
    return { ignored: false, error: classified };
  }

  let agent: ChannelInvocableAgent | undefined;
  let normalizedHistory: Message[];
  try {
    signal?.throwIfAborted();
    agent = resolveChannelInvokeAgent(payload.assistantId, deps);
    normalizedHistory = normalizeConversationHistoryForRuntime(payload.conversationHistory);
  } catch (error) {
    const classified = classifyChannelInvokeError(error, signal);
    logger.error("Channel invoke runtime preparation failed", {
      errorName: safeChannelErrorName(error, signal),
      errorCode: classified.code,
      retryable: classified.retryable,
    });
    return { ignored: false, error: classified };
  }
  if (!agent) {
    logger.error("Channel invoke could not resolve a runtime agent for the request", {
      errorName: "RuntimeAgentNotFoundError",
    });
    return {
      ignored: false,
      error: {
        code: "internal_error",
        retryable: false,
      },
    };
  }

  try {
    signal?.throwIfAborted();
    const generateProperty = readDataProperty(agent, "generate");
    if (
      !generateProperty.ok || !generateProperty.present ||
      typeof generateProperty.value !== "function"
    ) {
      throw new TypeError("Channel runtime agent has an invalid generate capability");
    }
    const generate = generateProperty.value as ChannelInvocableAgent["generate"];
    const result = await generate.call(agent, {
      input: normalizedHistory,
      memoryMode: "isolated",
      context: {
        requestId: payload.dispatchId,
        dispatchId: payload.dispatchId,
        conversationId: payload.conversationId,
        projectId: payload.projectId,
        assistantId: payload.assistantId,
        channel: payload.inboundMessage,
      },
      ...(payload.generation?.maxResponseTokens
        ? {
          maxOutputTokens: payload.generation.maxResponseTokens,
        }
        : {}),
      ...(signal ? { abortSignal: signal } : {}),
    });
    signal?.throwIfAborted();

    try {
      return ChannelInvokeResponseSchema.parse({
        ignored: false,
        responseParts: buildChannelResponseParts(result),
        tokenUsage: buildChannelTokenUsage(result),
      });
    } catch (error) {
      throw new ChannelResponseValidationError(error);
    }
  } catch (error) {
    const classified = classifyChannelInvokeError(error, signal);
    logger.error("Channel invoke runtime execution failed", {
      errorName: safeChannelErrorName(error, signal),
      errorCode: classified.code,
      retryable: classified.retryable,
    });

    return {
      ignored: false,
      error: classified,
    };
  }
}
