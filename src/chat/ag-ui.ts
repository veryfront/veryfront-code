import { mergeToolInputDelta, parseToolInputObject } from "#veryfront/agent/data-stream.ts";
import {
  formatToolErrorText,
  isCommentOnlySseFrame,
  isRecord,
  mapFinishReason,
  normalizeNewlines,
  parseSerializedToolResult,
  splitSseFrames,
  toRenderableCustomChunk,
} from "./ag-ui-helpers.ts";
import type { ChatStreamEvent } from "./protocol.ts";
import type { ChatUiMessage, ChatUiMessagePart } from "./types.ts";
import { z } from "zod";

type JsonPatchOperation = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
};

type ToolCallState = {
  toolName: string;
  argsText: string;
};

export type AgUiRuntimeToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AgUiRuntimeMessage =
  | {
    id: string;
    role: "system";
    content: string;
  }
  | {
    id: string;
    role: "user";
    content: string;
  }
  | {
    id: string;
    role: "assistant";
    content?: string;
    toolCalls?: AgUiRuntimeToolCall[];
  }
  | {
    id: string;
    role: "tool";
    toolCallId: string;
    content: string;
    error?: string;
  };

export type ParsedSseEvent = {
  id: number | null;
  event: string | null;
  data: string;
};

export type AgUiDecodedEvent = {
  eventId: number | null;
  wireEvent: AgUiWireEvent;
  chatEvents: ChatStreamEvent[];
};

export type AgUiDecodedChunk = {
  events: AgUiDecodedEvent[];
  remainder: string;
};

export type AgUiDecoderValidationMode = "permissive" | "strict";

export type AgUiChatEventDecoderState = {
  remainder: string;
  lastEventId: number;
  toolCalls: Map<string, ToolCallState>;
  reasoningFallbackIndex: number;
  activeFallbackReasoningPartId: string | null;
  validationMode: AgUiDecoderValidationMode;
  onInvalidJson: ((details: { eventName: string | null; dataLength: number }) => void) | null;
};

export const AgUiRunFinishedMetadataSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  finishReason: z.string().optional(),
  providerRequestId: z.string().optional(),
});

export const AgUiSnapshotToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
  encryptedValue: z.string().optional(),
});

const AgUiUserInputContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("binary"),
    mimeType: z.string(),
    id: z.string().optional(),
    url: z.string().optional(),
    data: z.string().optional(),
    filename: z.string().optional(),
  }),
]);

export const AgUiSnapshotMessageSchema = z.discriminatedUnion("role", [
  z.object({
    id: z.string(),
    role: z.literal("assistant"),
    content: z.string().optional(),
    name: z.string().optional(),
    encryptedValue: z.string().optional(),
    toolCalls: z.array(AgUiSnapshotToolCallSchema).optional(),
  }),
  z.object({
    id: z.string(),
    role: z.literal("user"),
    content: z.union([z.string(), z.array(AgUiUserInputContentSchema)]),
    name: z.string().optional(),
    encryptedValue: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    role: z.literal("tool"),
    toolCallId: z.string(),
    content: z.string(),
    error: z.string().optional(),
    encryptedValue: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    role: z.literal("reasoning"),
    content: z.string(),
    name: z.string().optional(),
    encryptedValue: z.string().optional(),
  }),
]);

export const AgUiWireEventNameSchema = z.enum([
  "RunStarted",
  "Custom",
  "TextMessageStart",
  "TextMessageContent",
  "TextMessageEnd",
  "ToolCallStart",
  "ToolCallArgs",
  "ToolCallChunk",
  "ToolCallEnd",
  "ToolCallResult",
  "StateSnapshot",
  "MessagesSnapshot",
  "ReasoningMessageStart",
  "ReasoningMessageContent",
  "ReasoningMessageEnd",
  "StateDelta",
  "RunFinished",
  "RunError",
]);

function parseRuntimeToolInput(rawArguments: string): unknown {
  try {
    return JSON.parse(rawArguments);
  } catch {
    return { raw: rawArguments };
  }
}

function parseRuntimeToolOutput(rawContent: string): unknown {
  try {
    return JSON.parse(rawContent);
  } catch {
    return rawContent;
  }
}

function createRuntimeSystemMessage(
  message: Extract<AgUiRuntimeMessage, { role: "system" }>,
): ChatUiMessage {
  return {
    id: message.id,
    role: "system",
    parts: [{ type: "text", text: message.content }],
  };
}

function createRuntimeUserMessage(
  message: Extract<AgUiRuntimeMessage, { role: "user" }>,
): ChatUiMessage {
  return {
    id: message.id,
    role: "user",
    parts: [{ type: "text", text: message.content }],
  };
}

function createRuntimeAssistantMessage(
  message: Extract<AgUiRuntimeMessage, { role: "assistant" }>,
): ChatUiMessage | null {
  const parts: ChatUiMessagePart[] = [];

  if (typeof message.content === "string" && message.content.trim().length > 0) {
    parts.push({ type: "text", text: message.content });
  }

  for (const toolCall of message.toolCalls ?? []) {
    parts.push({
      type: "dynamic-tool",
      toolName: toolCall.function.name,
      toolCallId: toolCall.id,
      input: parseRuntimeToolInput(toolCall.function.arguments),
      state: "input-available",
    });
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    id: message.id,
    role: "assistant",
    parts,
  };
}

function buildResolvedRuntimeToolPart(input: {
  toolName: string;
  toolCallId: string;
  toolInput: unknown;
  title?: string;
  providerExecuted?: boolean;
  error?: string;
  content: string;
}): ChatUiMessagePart {
  if (typeof input.error === "string" && input.error.length > 0) {
    return {
      type: "dynamic-tool",
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      ...(input.title ? { title: input.title } : {}),
      ...(input.providerExecuted !== undefined ? { providerExecuted: input.providerExecuted } : {}),
      input: input.toolInput,
      state: "output-error",
      errorText: input.error,
    };
  }

  return {
    type: "dynamic-tool",
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    ...(input.title ? { title: input.title } : {}),
    ...(input.providerExecuted !== undefined ? { providerExecuted: input.providerExecuted } : {}),
    input: input.toolInput,
    state: "output-available",
    output: parseRuntimeToolOutput(input.content),
  };
}

function applyRuntimeToolResultMessage(
  messages: ChatUiMessage[],
  message: Extract<AgUiRuntimeMessage, { role: "tool" }>,
): void {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const currentMessage = messages[messageIndex];
    if (currentMessage.role !== "assistant") {
      continue;
    }

    const partIndex = currentMessage.parts.findIndex(
      (part) =>
        part.type === "dynamic-tool" &&
        part.toolCallId === message.toolCallId &&
        (part.state === "input-available" || part.state === "input-streaming"),
    );

    if (partIndex === -1) {
      continue;
    }

    const part = currentMessage.parts[partIndex];
    if (part.type !== "dynamic-tool") {
      continue;
    }

    currentMessage.parts.splice(
      partIndex,
      1,
      buildResolvedRuntimeToolPart({
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        ...(part.title ? { title: part.title } : {}),
        ...(part.providerExecuted !== undefined ? { providerExecuted: part.providerExecuted } : {}),
        toolInput: part.input,
        error: message.error,
        content: message.content,
      }),
    );
    return;
  }

  messages.push({
    id: message.id,
    role: "assistant",
    parts: [
      buildResolvedRuntimeToolPart({
        toolName: "unknown",
        toolCallId: message.toolCallId,
        toolInput: {},
        error: message.error,
        content: message.content,
      }),
    ],
  });
}

export function mapAgUiRuntimeMessagesToChatUiMessages(
  messages: AgUiRuntimeMessage[],
): ChatUiMessage[] {
  const mappedMessages: ChatUiMessage[] = [];

  for (const message of messages) {
    switch (message.role) {
      case "system":
        mappedMessages.push(createRuntimeSystemMessage(message));
        break;

      case "user":
        mappedMessages.push(createRuntimeUserMessage(message));
        break;

      case "assistant": {
        const assistantMessage = createRuntimeAssistantMessage(message);
        if (assistantMessage) {
          mappedMessages.push(assistantMessage);
        }
        break;
      }

      case "tool":
        applyRuntimeToolResultMessage(mappedMessages, message);
        break;
    }
  }

  return mappedMessages;
}

export const AgUiWireEventSchema = z.discriminatedUnion("eventName", [
  z.object({
    eventName: z.literal("RunStarted"),
    payload: z.object({
      runId: z.string().optional(),
      threadId: z.string().optional(),
      agentId: z.string().optional(),
    }),
  }),
  z.object({
    eventName: z.literal("Custom"),
    payload: z.object({
      name: z.string(),
      value: z.unknown(),
    }),
  }),
  z.object({
    eventName: z.literal("TextMessageStart"),
    payload: z.object({
      messageId: z.string().min(1),
      id: z.string().min(1).optional(),
      contentId: z.string().min(1).optional(),
      role: z.string().optional(),
    }),
  }),
  z.object({
    eventName: z.literal("TextMessageContent"),
    payload: z.object({
      messageId: z.string().min(1),
      id: z.string().min(1).optional(),
      contentId: z.string().min(1).optional(),
      delta: z.string(),
    }),
  }),
  z.object({
    eventName: z.literal("TextMessageEnd"),
    payload: z.object({
      messageId: z.string().min(1),
      id: z.string().min(1).optional(),
      contentId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    eventName: z.literal("ToolCallStart"),
    payload: z.object({
      toolCallId: z.string().min(1),
      toolCallName: z.string().min(1),
    }),
  }),
  z.object({
    eventName: z.literal("ToolCallArgs"),
    payload: z.object({
      toolCallId: z.string().min(1),
      delta: z.string(),
    }),
  }),
  z.object({
    eventName: z.literal("ToolCallChunk"),
    payload: z.object({
      toolCallId: z.string().min(1),
      delta: z.string(),
    }),
  }),
  z.object({
    eventName: z.literal("ToolCallEnd"),
    payload: z.object({
      toolCallId: z.string().min(1),
    }),
  }),
  z.object({
    eventName: z.literal("ToolCallResult"),
    payload: z.object({
      messageId: z.string().min(1).optional(),
      toolCallId: z.string().min(1),
      input: z.unknown().optional(),
      content: z.unknown().optional(),
      result: z.unknown().optional(),
      role: z.literal("tool").optional(),
      isError: z.boolean().optional(),
    }),
  }),
  z.object({
    eventName: z.literal("StateSnapshot"),
    payload: z.object({
      snapshot: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    eventName: z.literal("MessagesSnapshot"),
    payload: z.object({
      messages: z.array(AgUiSnapshotMessageSchema),
    }),
  }),
  z.object({
    eventName: z.literal("ReasoningMessageStart"),
    payload: z.object({
      id: z.string().optional(),
      messageId: z.string().min(1).optional(),
      role: z.string().optional(),
    }),
  }),
  z.object({
    eventName: z.literal("ReasoningMessageContent"),
    payload: z.object({
      id: z.string().optional(),
      messageId: z.string().min(1).optional(),
      delta: z.string(),
    }),
  }),
  z.object({
    eventName: z.literal("ReasoningMessageEnd"),
    payload: z.object({
      id: z.string().optional(),
      messageId: z.string().min(1).optional(),
    }),
  }),
  z.object({
    eventName: z.literal("StateDelta"),
    payload: z.object({
      delta: z.union([
        z.record(z.string(), z.unknown()),
        z.array(
          z.object({
            op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
            path: z.string().min(1),
            from: z.string().min(1).optional(),
            value: z.unknown().optional(),
          }),
        ),
      ]),
    }),
  }),
  z.object({
    eventName: z.literal("RunFinished"),
    payload: z.object({
      metadata: AgUiRunFinishedMetadataSchema.optional(),
    }),
  }),
  z.object({
    eventName: z.literal("RunError"),
    payload: z.object({
      code: z.string().optional(),
      message: z.string().optional(),
    }),
  }),
]);

export type AgUiRunFinishedMetadata = z.infer<typeof AgUiRunFinishedMetadataSchema>;
export type AgUiSnapshotMessage = z.infer<typeof AgUiSnapshotMessageSchema>;
export type AgUiWireEventName = z.infer<typeof AgUiWireEventNameSchema>;
export type AgUiWireEvent = z.infer<typeof AgUiWireEventSchema>;

function getReasoningPartId(
  state: AgUiChatEventDecoderState,
  payload: { id?: string; messageId?: string },
  phase: "start" | "content" | "end",
): string {
  if (typeof payload.id === "string" && payload.id.length > 0) {
    return payload.id;
  }

  if (typeof payload.messageId === "string" && payload.messageId.length > 0) {
    return `agui-reasoning:${payload.messageId}`;
  }

  if (state.activeFallbackReasoningPartId) {
    const fallbackId = state.activeFallbackReasoningPartId;
    if (phase === "end") {
      state.activeFallbackReasoningPartId = null;
    }
    return fallbackId;
  }

  state.reasoningFallbackIndex += 1;
  const fallbackId = `agui-reasoning:${state.reasoningFallbackIndex}`;
  if (phase !== "end") {
    state.activeFallbackReasoningPartId = fallbackId;
  }
  return fallbackId;
}

function parseAgUiWireEvent(
  frame: ParsedSseEvent,
  input: {
    validationMode: AgUiDecoderValidationMode;
    onInvalidJson: ((details: { eventName: string | null; dataLength: number }) => void) | null;
  },
): AgUiWireEvent | null {
  if (frame.data === "[DONE]" || !frame.event || !frame.data) {
    return null;
  }

  const eventName = AgUiWireEventNameSchema.safeParse(frame.event);
  if (!eventName.success) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    input.onInvalidJson?.({
      eventName: frame.event,
      dataLength: frame.data.length,
    });
    return null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const parsed = AgUiWireEventSchema.safeParse({
    eventName: eventName.data,
    payload,
  });

  if (!parsed.success && input.validationMode === "strict") {
    throw new Error(`Malformed AG-UI event payload for ${eventName.data}`);
  }

  return parsed.success ? parsed.data : null;
}

function mapWireEventToChatEvents(
  state: AgUiChatEventDecoderState,
  wireEvent: AgUiWireEvent,
): ChatStreamEvent[] {
  switch (wireEvent.eventName) {
    case "RunStarted":
      return [{
        type: "start",
        messageMetadata: wireEvent.payload,
      }];

    case "TextMessageStart":
      return [{
        type: "text-start",
        id: wireEvent.payload.messageId,
      }];

    case "TextMessageContent":
      return [{
        type: "text-delta",
        id: wireEvent.payload.messageId,
        delta: wireEvent.payload.delta,
      }];

    case "TextMessageEnd":
      return [{
        type: "text-end",
        id: wireEvent.payload.messageId,
      }];

    case "ReasoningMessageStart":
      return [{
        type: "reasoning-start",
        id: getReasoningPartId(state, wireEvent.payload, "start"),
      }];

    case "ReasoningMessageContent":
      return [{
        type: "reasoning-delta",
        id: getReasoningPartId(state, wireEvent.payload, "content"),
        delta: wireEvent.payload.delta,
      }];

    case "ReasoningMessageEnd":
      return [{
        type: "reasoning-end",
        id: getReasoningPartId(state, wireEvent.payload, "end"),
      }];

    case "ToolCallStart":
      state.toolCalls.set(wireEvent.payload.toolCallId, {
        toolName: wireEvent.payload.toolCallName,
        argsText: "",
      });
      return [{
        type: "tool-input-start",
        toolCallId: wireEvent.payload.toolCallId,
        toolName: wireEvent.payload.toolCallName,
        providerExecuted: true,
      }];

    case "ToolCallArgs":
    case "ToolCallChunk": {
      const toolCall = state.toolCalls.get(wireEvent.payload.toolCallId);
      if (!toolCall) {
        return [];
      }

      toolCall.argsText = mergeToolInputDelta(toolCall.argsText, wireEvent.payload.delta);
      return [{
        type: "tool-input-delta",
        toolCallId: wireEvent.payload.toolCallId,
        inputTextDelta: wireEvent.payload.delta,
      }];
    }

    case "ToolCallEnd": {
      const toolCall = state.toolCalls.get(wireEvent.payload.toolCallId);
      if (!toolCall) {
        return [];
      }

      return [{
        type: "tool-input-available",
        toolCallId: wireEvent.payload.toolCallId,
        toolName: toolCall.toolName,
        input: parseToolInputObject(toolCall.argsText),
        providerExecuted: true,
      }];
    }

    case "ToolCallResult": {
      const toolCall = state.toolCalls.get(wireEvent.payload.toolCallId);
      const parsedResult = parseSerializedToolResult(
        wireEvent.payload.content ?? wireEvent.payload.result,
      );

      if (wireEvent.payload.isError) {
        return [{
          type: "tool-output-error",
          toolCallId: wireEvent.payload.toolCallId,
          errorText: formatToolErrorText(parsedResult),
          providerExecuted: true,
        }];
      }

      const events: ChatStreamEvent[] = [];
      if (!toolCall) {
        events.push({
          type: "tool-input-available",
          toolCallId: wireEvent.payload.toolCallId,
          toolName: "tool",
          input: wireEvent.payload.input ?? {},
          dynamic: true,
          providerExecuted: true,
        });
      }

      events.push({
        type: "tool-output-available",
        toolCallId: wireEvent.payload.toolCallId,
        output: parsedResult,
        providerExecuted: true,
      });
      return events;
    }

    case "StateSnapshot":
      return [{ type: "data-state-snapshot", data: wireEvent.payload.snapshot }];

    case "StateDelta":
      return [{
        type: "data-state-delta",
        data: wireEvent.payload.delta as Record<string, unknown> | JsonPatchOperation[],
      }];

    case "MessagesSnapshot":
      return [{ type: "data-messages-snapshot", data: wireEvent.payload.messages }];

    case "Custom": {
      const renderableChunk = toRenderableCustomChunk(wireEvent.payload.value);
      if (renderableChunk) {
        return [renderableChunk];
      }

      return [{
        type: `data-${wireEvent.payload.name}`,
        data: wireEvent.payload.value,
      }];
    }

    case "RunFinished":
      return [{
        type: "finish",
        ...(mapFinishReason(wireEvent.payload.metadata?.finishReason)
          ? { finishReason: mapFinishReason(wireEvent.payload.metadata?.finishReason) }
          : {}),
      }];

    case "RunError":
      if (wireEvent.payload.code === "CANCELLED") {
        return [{ type: "abort" }];
      }

      return [{
        type: "error",
        errorText: wireEvent.payload.message?.length
          ? wireEvent.payload.message
          : "Conversation agent run failed",
      }];
  }
}

export function parseSseEvent(raw: string): ParsedSseEvent {
  let id: number | null = null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("id:")) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isFinite(parsed)) {
        id = parsed;
      }
      continue;
    }

    if (line.startsWith("event:")) {
      const value = line.slice(6).trim();
      event = value.length > 0 ? value : null;
      continue;
    }

    if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  return { id, event, data: dataLines.join("\n") };
}

export function createAgUiChatEventDecoderState(
  input: {
    lastEventId?: number;
    validationMode?: AgUiDecoderValidationMode;
    onInvalidJson?: (details: { eventName: string | null; dataLength: number }) => void;
  } = {},
): AgUiChatEventDecoderState {
  return {
    remainder: "",
    lastEventId: input.lastEventId ?? -1,
    toolCalls: new Map<string, ToolCallState>(),
    reasoningFallbackIndex: 0,
    activeFallbackReasoningPartId: null,
    validationMode: input.validationMode ?? "permissive",
    onInvalidJson: input.onInvalidJson ?? null,
  };
}

export function decodeAgUiSseChunk(
  state: AgUiChatEventDecoderState,
  chunk: string,
): AgUiDecodedChunk {
  const normalized = `${state.remainder}${normalizeNewlines(chunk)}`;
  const { frames, remainder } = splitSseFrames(normalized);
  state.remainder = remainder;

  const events: AgUiDecodedEvent[] = [];

  for (const rawFrame of frames) {
    if (isCommentOnlySseFrame(rawFrame)) {
      continue;
    }

    const frame = parseSseEvent(rawFrame);
    if (frame.id !== null) {
      if (frame.id <= state.lastEventId) {
        continue;
      }
      state.lastEventId = frame.id;
    }

    const wireEvent = parseAgUiWireEvent(frame, {
      validationMode: state.validationMode,
      onInvalidJson: state.onInvalidJson,
    });
    if (!wireEvent) {
      continue;
    }

    events.push({
      eventId: frame.id,
      wireEvent,
      chatEvents: mapWireEventToChatEvents(state, wireEvent),
    });
  }

  return {
    events,
    remainder: state.remainder,
  };
}

export function flushAgUiSseChunk(state: AgUiChatEventDecoderState): AgUiDecodedChunk {
  if (state.remainder.length === 0) {
    return { events: [], remainder: "" };
  }

  const flushed = decodeAgUiSseChunk(state, "\n\n");
  state.remainder = "";
  return {
    events: flushed.events,
    remainder: "",
  };
}
