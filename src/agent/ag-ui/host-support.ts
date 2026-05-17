import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { formatAgUiEvent } from "#veryfront/internal-agents/ag-ui-sse.ts";
import type { Message } from "../types.ts";
import { parseAgUiJsonRequestOrError } from "./request-shared.ts";

const AGENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_TOOL_PARAMETERS_BYTES = 16_384;
const MAX_CONTEXT_ITEM_BYTES = 16_384;
const MAX_CONTEXT_TOTAL_BYTES = 65_536;
const MAX_FORWARDED_PROPS_BYTES = 65_536;
const MAX_TEXT_PART_LENGTH = 10_000;
const MAX_MESSAGES_PER_REQUEST = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AgUiSseEvent {
  event: string;
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

export const getAgUiInjectedToolSchema = defineSchema((v) =>
  v.object({
    name: v.string().min(1).max(128),
    description: v.string().max(1024).optional(),
    parameters: v.record(v.string(), v.unknown()).optional().refine(
      (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
      { message: "Tool parameters must be less than 16 KB" },
    ),
  })
);

export const getAgUiContextItemSchema = defineSchema((v) =>
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
    role: v.enum(["user", "assistant", "system", "tool"]),
    parts: v.array(getAgUiMessagePartSchema()).default([]),
    metadata: v.record(v.string(), v.unknown()).optional(),
    createdAt: v.string().optional(),
  })
);

export const getAgUiRequestSchema = defineSchema((v) =>
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
      { message: "forwardedProps must be less than 64 KB" },
    ),
    model: v.string().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  })
);

/** @deprecated Use getAgUiInjectedToolSchema() */
export const AgUiInjectedToolSchema = lazySchema(getAgUiInjectedToolSchema);
/** @deprecated Use getAgUiContextItemSchema() */
export const AgUiContextItemSchema = lazySchema(getAgUiContextItemSchema);
/** @deprecated Use getAgUiRequestSchema() */
export const AgUiRequestSchema = lazySchema(getAgUiRequestSchema);

export type AgUiInjectedTool = InferSchema<ReturnType<typeof getAgUiInjectedToolSchema>>;
export type AgUiContextItem = InferSchema<ReturnType<typeof getAgUiContextItemSchema>>;
export type AgUiRequest = InferSchema<ReturnType<typeof getAgUiRequestSchema>>;

function normalizeToolArgs(part: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(part.args)) return part.args;
  if (isRecord(part.input)) return part.input;
  return {};
}

function normalizeMessagePart(part: Record<string, unknown>): Message["parts"][number] | null {
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
      toolName: typeof part.tool_name === "string" ? part.tool_name : "unknown",
      result: "output" in part ? part.output : undefined,
    };
  }

  if (part.type === "tool-result" && typeof part.toolCallId === "string") {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: typeof part.toolName === "string" ? part.toolName : "unknown",
      result: "result" in part ? part.result : undefined,
    };
  }

  return null;
}

export async function parseAgUiRequest(request: Request): Promise<AgUiRequest> {
  return getAgUiRequestSchema().parse(await request.json());
}

export async function parseAgUiRequestOrError(
  request: Request,
): Promise<AgUiRequest | Response> {
  return await parseAgUiJsonRequestOrError(
    () => parseAgUiRequest(request),
    "Invalid AG-UI request",
  );
}

export function normalizeAgUiMessages(messages: AgUiRequest["messages"]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts
      .map((part) => normalizeMessagePart(part))
      .filter((part): part is Message["parts"][number] => part !== null),
    ...(message.createdAt ? { timestamp: Date.parse(message.createdAt) || undefined } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  })) as any;
}

export function createAgUiRunErrorEvent(message: string, code?: string): AgUiSseEvent {
  return {
    event: "RunError",
    payload: {
      message,
      ...(code ? { code } : {}),
    },
  };
}

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
