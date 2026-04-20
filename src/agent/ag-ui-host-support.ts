import { z } from "zod";
import { formatAgUiEvent } from "#veryfront/internal-agents/ag-ui-sse.ts";
import type { Message } from "./types.ts";

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

const AgUiRunIdSchema = z.string().min(1).max(128).regex(AGENT_ID_PATTERN);

export const AgUiInjectedToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  parameters: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_TOOL_PARAMETERS_BYTES),
    { message: "Tool parameters must be less than 16 KB" },
  ),
});

export const AgUiContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    title: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES),
  }),
  z.object({
    type: z.literal("json"),
    title: z.string().max(256).optional(),
    data: z.record(z.string(), z.unknown()).refine(
      (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_ITEM_BYTES),
      { message: "JSON context item must be less than 16 KB" },
    ),
  }),
  z.object({
    type: z.literal("resource"),
    title: z.string().max(256).optional(),
    uri: z.string().max(2048),
    mimeType: z.string().max(256).optional(),
    text: z.string().max(MAX_CONTEXT_ITEM_BYTES).optional(),
  }),
]);

const AgUiMessagePartSchema = z.object({ type: z.string().min(1) }).passthrough();

const AgUiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  parts: z.array(AgUiMessagePartSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
});

export const AgUiRequestSchema = z.object({
  threadId: z.string().uuid().optional(),
  runId: AgUiRunIdSchema.optional(),
  messages: z.array(AgUiMessageSchema).min(1).max(MAX_MESSAGES_PER_REQUEST),
  tools: z.array(AgUiInjectedToolSchema).max(50).default([]),
  context: z.array(AgUiContextItemSchema).max(10).default([]).refine(
    (value) => isWithinJsonSizeLimit(value, MAX_CONTEXT_TOTAL_BYTES),
    { message: "context must be less than 64 KB total" },
  ),
  forwardedProps: z.record(z.string(), z.unknown()).optional().refine(
    (value) => value === undefined || isWithinJsonSizeLimit(value, MAX_FORWARDED_PROPS_BYTES),
    { message: "forwardedProps must be less than 64 KB" },
  ),
  model: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

export type AgUiInjectedTool = z.infer<typeof AgUiInjectedToolSchema>;
export type AgUiContextItem = z.infer<typeof AgUiContextItemSchema>;
export type AgUiRequest = z.infer<typeof AgUiRequestSchema>;

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
  return AgUiRequestSchema.parse(await request.json());
}

export async function parseAgUiRequestOrError(
  request: Request,
): Promise<AgUiRequest | Response> {
  try {
    return await parseAgUiRequest(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "Invalid AG-UI request",
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    if (error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json(
        {
          error: "Invalid AG-UI request",
          details: [{ path: [], message: "Malformed JSON request body" }],
        },
        { status: 400 },
      );
    }

    throw error;
  }
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
  }));
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
