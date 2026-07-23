import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { formatAgUiEvent } from "#veryfront/internal-agents/ag-ui-sse.ts";
import type { Message } from "../types.ts";
import { parseAgUiJsonBody, parseAgUiJsonRequestOrError } from "./request-shared.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 196_608;
const MAX_TEXT_PART_LENGTH = 10_000;
const MAX_MESSAGES_PER_REQUEST = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Client-defined tool declaration supplied in an AG-UI request. */
export interface AgUiInjectedTool {
  /** Tool name. */
  name: string;
  /** Optional tool description. */
  description?: string;
  /** Optional JSON Schema parameters. */
  parameters?: Record<string, unknown>;
}

/** Context item supplied in an AG-UI request. */
export type AgUiContextItem =
  | { type: "text"; title?: string; text: string }
  | { type: "json"; title?: string; data: Record<string, unknown> }
  | { type: "resource"; title?: string; uri: string; mimeType?: string; text?: string };

/** Message accepted by the AG-UI request schema. */
export interface AgUiRequestMessage {
  /** Message identifier. */
  id: string;
  /** Message author role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Provider-neutral message parts. */
  parts: Array<Record<string, unknown> & { type: string }>;
  /** Optional message metadata. */
  metadata?: Record<string, unknown>;
  /** Optional ISO timestamp supplied by the client. */
  createdAt?: string;
}

/** Validated AG-UI request payload. */
export interface AgUiRequest {
  /** Conversation thread identifier. */
  threadId?: string;
  /** Runtime run identifier. */
  runId?: string;
  /** Ordered conversation messages. */
  messages: AgUiRequestMessage[];
  /** Client-defined tools. */
  tools: AgUiInjectedTool[];
  /** Request context items. */
  context: AgUiContextItem[];
  /** Opaque properties forwarded to the runtime. */
  forwardedProps?: Record<string, unknown>;
  /** Optional model override. */
  model?: string;
  /** Optional output token limit. */
  maxOutputTokens?: number;
}

/** Event emitted for AG-UI sse. */
export interface AgUiSseEvent {
  /** Event value. */
  event: string;
  /** Payload value. */
  payload: Record<string, unknown>;
}

function isWithinJsonSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const getAgUiRunIdSchema = defineSchema((v) => v.string().min(1).max(128).regex(AGENT_ID_PATTERN));

/** Returns the AG-UI injected tool schema. */
export const getAgUiInjectedToolSchema: () => Schema<AgUiInjectedTool> = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(128),
    description: v.string().max(1024).optional(),
    parameters: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
      { message: "Tool parameters must be less than 16 KB" },
    ),
  })
);

/** Returns the AG-UI context item schema. */
export const getAgUiContextItemSchema: () => Schema<AgUiContextItem> = defineSchema((v) =>
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

const getAgUiMessagePartSchema = defineSchema((v) =>
  v.object({ type: v.string().min(1) }).passthrough().refine(
    (part) =>
      part.type !== "text" ||
      (typeof part.text === "string" && part.text.length <= MAX_TEXT_PART_LENGTH),
    {
      message: `Text message parts must include text less than ${MAX_TEXT_PART_LENGTH} characters`,
    },
  )
);

const getAgUiMessageSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    role: v.enum(["user", "assistant", "system", "tool"] as const),
    parts: v.array(getAgUiMessagePartSchema()).default([]),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().optional(),
  })
);

/** Returns the AG-UI request schema. */
export const getAgUiRequestSchema: () => Schema<AgUiRequest> = defineSchema((v) =>
  v.object({
    threadId: v.string().uuid().optional(),
    runId: getAgUiRunIdSchema().optional(),
    messages: v.array(getAgUiMessageSchema()).min(1).max(MAX_MESSAGES_PER_REQUEST),
    tools: v.array(getAgUiInjectedToolSchema()).max(50).default([]),
    context: v.array(getAgUiContextItemSchema()).max(10).default([]).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
      { message: "context must be less than 64 KB total" },
    ),
    forwardedProps: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
      { message: "forwardedProps must be less than 192 KB" },
    ),
    model: v.string().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  })
);

/** @deprecated Use getAgUiInjectedToolSchema() */
export const AgUiInjectedToolSchema = lazySchema(getAgUiInjectedToolSchema);
/** @deprecated Use getAgUiContextItemSchema() */
export const AgUiContextItemSchema = lazySchema(getAgUiContextItemSchema);
/** Schema for AG-UI request.
 * @deprecated Use getAgUiRequestSchema()
 */
export const AgUiRequestSchema: Schema<AgUiRequest> = lazySchema(getAgUiRequestSchema);

/** Options for normalizing AG-UI messages into agent messages. */
export interface NormalizeAgUiMessagesOptions {
  /** Tool names whose calls and results are owned by the provider. */
  providerOwnedToolNames?: readonly string[];
}

function normalizeToolArgs(part: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.input)) return part.input;
  return {};
}

function isToolPartWithOutput(
  part: Record<string, unknown>,
): part is Record<string, unknown> & {
  type: string;
  toolCallId: string;
  toolName: string;
  output: unknown;
} {
  return typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    part.type !== "tool-result" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string" &&
    "output" in part &&
    part.output !== undefined;
}

function hasToolResultPart(
  parts: Array<Record<string, unknown>>,
  toolCallId: string,
): boolean {
  return parts.some((part) =>
    (part.type === "tool-result" && part.toolCallId === toolCallId) ||
    (part.type === "tool_result" && part.tool_call_id === toolCallId)
  );
}

function getMessagePartToolCallId(part: Message["parts"][number]): string | undefined {
  const record = part as Record<string, unknown>;
  const value = record.toolCallId ?? record.tool_call_id ?? record.id;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getMessagePartToolName(part: Message["parts"][number]): string | undefined {
  const record = part as Record<string, unknown>;
  const explicitToolName = record.toolName ?? record.tool_name ?? record.name;
  if (typeof explicitToolName === "string" && explicitToolName.length > 0) {
    return explicitToolName;
  }

  return part.type.startsWith("tool-") && part.type !== "tool-call" && part.type !== "tool-result"
    ? part.type.replace(/^tool-/, "")
    : undefined;
}

function shouldKeepProviderVisibleToolPart(
  part: Message["parts"][number],
  providerOwnedToolNames: ReadonlySet<string>,
  providerOwnedToolCallIds: Set<string>,
): boolean {
  if (providerOwnedToolNames.size === 0) {
    return true;
  }

  const toolName = getMessagePartToolName(part);
  const toolCallId = getMessagePartToolCallId(part);
  const ownedByName = toolName ? providerOwnedToolNames.has(toolName) : false;
  const ownedByCallId = toolCallId ? providerOwnedToolCallIds.has(toolCallId) : false;

  if (!ownedByName && !ownedByCallId) {
    return true;
  }

  if (toolCallId) {
    providerOwnedToolCallIds.add(toolCallId);
  }
  return false;
}

function normalizeMessagePart(
  part: Record<string, unknown>,
  toolNamesById: ReadonlyMap<string, string> = new Map(),
): Message["parts"][number] | null {
  if (
    part.type === "text" && typeof part.text === "string" &&
    part.text.length <= MAX_TEXT_PART_LENGTH
  ) {
    return { type: "text", text: part.text };
  }

  if (part.type === "tool_call" && typeof part.id === "string" && typeof part.name === "string") {
    return {
      type: "tool-call",
      toolCallId: part.id,
      toolName: part.name,
      args: normalizeToolArgs(part),
    };
  }

  if (
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    return {
      type: "tool-call",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: normalizeToolArgs(part),
    };
  }

  if (
    typeof part.type === "string" &&
    part.type.startsWith("tool-") &&
    part.type !== "tool-result" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  ) {
    return {
      type: part.type,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: normalizeToolArgs(part),
    };
  }

  if (part.type === "tool_result" && typeof part.tool_call_id === "string") {
    return {
      type: "tool-result",
      toolCallId: part.tool_call_id,
      toolName: typeof part.tool_name === "string"
        ? part.tool_name
        : toolNamesById.get(part.tool_call_id) ?? "unknown",
      result: "output" in part ? part.output : undefined,
    };
  }

  if (part.type === "tool-result" && typeof part.toolCallId === "string") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: typeof part.toolName === "string"
        ? part.toolName
        : toolNamesById.get(part.toolCallId) ?? "unknown",
      result: "result" in part ? part.result : undefined,
    };
  }

  // Attachments: keep `file`/`image` parts (multimodal input). The composer
  // sends every attachment as `type: "file"`, so route by media type — images
  // become `image` parts the model can view, everything else stays `file`.
  // The `url` may be a fetchable URL or an inline `data:` base64 URL.
  if (
    (part.type === "file" || part.type === "image") &&
    typeof part.url === "string" && part.url.length > 0 &&
    typeof part.mediaType === "string" && part.mediaType.length > 0
  ) {
    const isImage = part.type === "image" || part.mediaType.startsWith("image/");
    return isImage
      ? { type: "image", url: part.url, mediaType: part.mediaType }
      : { type: "file", url: part.url, mediaType: part.mediaType };
  }

  return null;
}

type AgUiMessage = AgUiRequest["messages"][number];

function buildMessageMetadataFields(message: AgUiMessage): Partial<Message> {
  return {
    ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  } as Partial<Message>;
}

function normalizeAssistantMessage(
  message: AgUiMessage,
  providerOwnedToolNames: ReadonlySet<string>,
  providerOwnedToolCallIds: Set<string>,
  toolNamesById: Map<string, string>,
): Message[] {
  const messages: Message[] = [];
  const metadataFields = buildMessageMetadataFields(message);
  let segmentParts: Message["parts"] = [];
  let segmentIndex = 0;

  const flushAssistantSegment = () => {
    if (segmentParts.length === 0) return;
    messages.push({
      id: segmentIndex === 0 ? message.id : `${message.id}-${segmentIndex}`,
      role: "assistant",
      parts: segmentParts,
      ...metadataFields,
    } as Message);
    segmentParts = [];
    segmentIndex += 1;
  };

  for (const part of message.parts) {
    const normalizedPart = normalizeMessagePart(part, toolNamesById);
    if (!normalizedPart) continue;
    if (normalizedPart.type !== "tool-result" && "toolCallId" in normalizedPart) {
      toolNamesById.set(normalizedPart.toolCallId, normalizedPart.toolName);
    }

    if (
      !shouldKeepProviderVisibleToolPart(
        normalizedPart,
        providerOwnedToolNames,
        providerOwnedToolCallIds,
      )
    ) {
      continue;
    }

    if (isToolPartWithOutput(part) && !hasToolResultPart(message.parts, part.toolCallId)) {
      segmentParts.push(normalizedPart);
      flushAssistantSegment();
      messages.push({
        id: `tool_${part.toolCallId}`,
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: part.output,
        }],
      } as Message);
      continue;
    }

    segmentParts.push(normalizedPart);
  }

  flushAssistantSegment();
  return messages;
}

/** Request payload for parse AG-UI. */
export async function parseAgUiRequest(request: Request): Promise<AgUiRequest> {
  return getAgUiRequestSchema().parse(await parseAgUiJsonBody(request));
}

/** Error shape for parse AG-UI request or. */
export async function parseAgUiRequestOrError(
  request: Request,
): Promise<AgUiRequest | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseAgUiRequest(request),
    "Invalid AG-UI request",
  );
}

/** Normalizes AG-UI messages. */
export function normalizeAgUiMessages(
  messages: AgUiRequest["messages"],
  options: NormalizeAgUiMessagesOptions = {},
): Message[] {
  const providerOwnedToolNames = new Set(options.providerOwnedToolNames ?? []);
  const providerOwnedToolCallIds = new Set<string>();
  const toolNamesById = new Map<string, string>();

  return messages.flatMap((message) => {
    if (message.role === "user" || message.role === "system") {
      providerOwnedToolCallIds.clear();
      toolNamesById.clear();
    }

    if (message.role === "assistant") {
      return normalizeAssistantMessage(
        message,
        providerOwnedToolNames,
        providerOwnedToolCallIds,
        toolNamesById,
      );
    }

    const normalizedMessage = {
      id: message.id,
      role: message.role,
      parts: message.parts
        .map((part) => normalizeMessagePart(part, toolNamesById))
        .filter((part): part is Message["parts"][number] => part !== null)
        .filter((part) =>
          shouldKeepProviderVisibleToolPart(
            part,
            providerOwnedToolNames,
            providerOwnedToolCallIds,
          )
        ),
      ...buildMessageMetadataFields(message),
    } as Message;

    return normalizedMessage.parts.length > 0 ? [normalizedMessage] : [];
  });
}

/** Event emitted for create AG-UI run error. */
export function createAgUiRunErrorEvent(message: string, code?: string): AgUiSseEvent {
  return {
    event: "RunError",
    payload: {
      message,
      ...(code ? { code } : {}),
    },
  };
}

/** Response payload for create AG-UI sse error. */
export function createAgUiSseErrorResponse(event: AgUiSseEvent, status: number): Response {
  return new Response(decoder.decode(formatAgUiEvent(event.event, event.payload)), {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Response payload for create AG-UI sse. */
export function createAgUiSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
