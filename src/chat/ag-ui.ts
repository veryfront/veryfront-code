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
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

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

export const getAgUiRunFinishedMetadataSchema = defineSchema((v) =>
  v.object({
    provider: v.string().optional(),
    model: v.string().optional(),
    inputTokens: v.number().int().nonnegative().optional(),
    outputTokens: v.number().int().nonnegative().optional(),
    totalTokens: v.number().int().nonnegative().optional(),
    cachedInputTokens: v.number().int().nonnegative().optional(),
    reasoningTokens: v.number().int().nonnegative().optional(),
    finishReason: v.string().optional(),
    providerRequestId: v.string().optional(),
  })
);

/** @deprecated Use getAgUiRunFinishedMetadataSchema() */
export const AgUiRunFinishedMetadataSchema = lazySchema(getAgUiRunFinishedMetadataSchema);

export const getAgUiSnapshotToolCallSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    type: v.literal("function"),
    function: v.object({
      name: v.string().min(1),
      arguments: v.string(),
    }),
    encryptedValue: v.string().optional(),
  })
);

/** @deprecated Use getAgUiSnapshotToolCallSchema() */
export const AgUiSnapshotToolCallSchema = lazySchema(getAgUiSnapshotToolCallSchema);

const getAgUiUserInputContentSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("text"),
      text: v.string(),
    }),
    v.object({
      type: v.literal("binary"),
      mimeType: v.string(),
      id: v.string().optional(),
      url: v.string().optional(),
      data: v.string().optional(),
      filename: v.string().optional(),
    }),
  ])
);

export const getAgUiSnapshotMessageSchema = defineSchema((v) =>
  v.discriminatedUnion("role", [
    v.object({
      id: v.string(),
      role: v.literal("assistant"),
      content: v.string().optional(),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
      toolCalls: v.array(getAgUiSnapshotToolCallSchema()).optional(),
    }),
    v.object({
      id: v.string(),
      role: v.literal("user"),
      content: v.union([v.string(), v.array(getAgUiUserInputContentSchema())]),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
    v.object({
      id: v.string(),
      role: v.literal("tool"),
      toolCallId: v.string(),
      content: v.string(),
      error: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
    v.object({
      id: v.string(),
      role: v.literal("reasoning"),
      content: v.string(),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
  ])
);

/** @deprecated Use getAgUiSnapshotMessageSchema() */
export const AgUiSnapshotMessageSchema = lazySchema(getAgUiSnapshotMessageSchema);

export const getAgUiWireEventNameSchema = defineSchema((v) =>
  v.enum([
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
  ])
);

/** @deprecated Use getAgUiWireEventNameSchema() */
export const AgUiWireEventNameSchema = lazySchema(getAgUiWireEventNameSchema);

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
    if (!currentMessage || currentMessage.role !== "assistant") {
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
    if (!part || part.type !== "dynamic-tool") {
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

export const getAgUiWireEventSchema = defineSchema((v) =>
  v.discriminatedUnion("eventName", [
    v.object({
      eventName: v.literal("RunStarted"),
      payload: v.object({
        runId: v.string().optional(),
        threadId: v.string().optional(),
        agentId: v.string().optional(),
      }),
    }),
    v.object({
      eventName: v.literal("Custom"),
      payload: v.object({ name: v.string(), value: v.unknown() }),
    }),
    v.object({
      eventName: v.literal("TextMessageStart"),
      payload: v.object({
        messageId: v.string().min(1),
        id: v.string().min(1).optional(),
        contentId: v.string().min(1).optional(),
        role: v.string().optional(),
      }),
    }),
    v.object({
      eventName: v.literal("TextMessageContent"),
      payload: v.object({
        messageId: v.string().min(1),
        id: v.string().min(1).optional(),
        contentId: v.string().min(1).optional(),
        delta: v.string(),
      }),
    }),
    v.object({
      eventName: v.literal("TextMessageEnd"),
      payload: v.object({
        messageId: v.string().min(1),
        id: v.string().min(1).optional(),
        contentId: v.string().min(1).optional(),
      }),
    }),
    v.object({
      eventName: v.literal("ToolCallStart"),
      payload: v.object({ toolCallId: v.string().min(1), toolCallName: v.string().min(1) }),
    }),
    v.object({
      eventName: v.literal("ToolCallArgs"),
      payload: v.object({ toolCallId: v.string().min(1), delta: v.string() }),
    }),
    v.object({
      eventName: v.literal("ToolCallChunk"),
      payload: v.object({ toolCallId: v.string().min(1), delta: v.string() }),
    }),
    v.object({
      eventName: v.literal("ToolCallEnd"),
      payload: v.object({ toolCallId: v.string().min(1) }),
    }),
    v.object({
      eventName: v.literal("ToolCallResult"),
      payload: v.object({
        messageId: v.string().min(1).optional(),
        toolCallId: v.string().min(1),
        input: v.unknown().optional(),
        content: v.unknown().optional(),
        result: v.unknown().optional(),
        role: v.literal("tool").optional(),
        isError: v.boolean().optional(),
      }),
    }),
    v.object({
      eventName: v.literal("StateSnapshot"),
      payload: v.object({ snapshot: v.record(v.string(), v.unknown()) }),
    }),
    v.object({
      eventName: v.literal("MessagesSnapshot"),
      payload: v.object({ messages: v.array(getAgUiSnapshotMessageSchema()) }),
    }),
    v.object({
      eventName: v.literal("ReasoningMessageStart"),
      payload: v.object({
        id: v.string().optional(),
        messageId: v.string().min(1).optional(),
        role: v.string().optional(),
      }),
    }),
    v.object({
      eventName: v.literal("ReasoningMessageContent"),
      payload: v.object({
        id: v.string().optional(),
        messageId: v.string().min(1).optional(),
        delta: v.string(),
      }),
    }),
    v.object({
      eventName: v.literal("ReasoningMessageEnd"),
      payload: v.object({ id: v.string().optional(), messageId: v.string().min(1).optional() }),
    }),
    v.object({
      eventName: v.literal("StateDelta"),
      payload: v.object({
        delta: v.union([
          v.record(v.string(), v.unknown()),
          v.array(
            v.object({
              op: v.enum(["add", "remove", "replace", "move", "copy", "test"]),
              path: v.string().min(1),
              from: v.string().min(1).optional(),
              value: v.unknown().optional(),
            }),
          ),
        ]),
      }),
    }),
    v.object({
      eventName: v.literal("RunFinished"),
      payload: v.object({ metadata: getAgUiRunFinishedMetadataSchema().optional() }),
    }),
    v.object({
      eventName: v.literal("RunError"),
      payload: v.object({ code: v.string().optional(), message: v.string().optional() }),
    }),
  ])
);

/** @deprecated Use getAgUiWireEventSchema() */
export const AgUiWireEventSchema = lazySchema(getAgUiWireEventSchema);

export type AgUiRunFinishedMetadata = InferSchema<
  ReturnType<typeof getAgUiRunFinishedMetadataSchema>
>;
export type AgUiSnapshotMessage = InferSchema<ReturnType<typeof getAgUiSnapshotMessageSchema>>;
export type AgUiWireEventName = InferSchema<ReturnType<typeof getAgUiWireEventNameSchema>>;
export type AgUiWireEvent = InferSchema<ReturnType<typeof getAgUiWireEventSchema>>;

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

  const eventName = getAgUiWireEventNameSchema().safeParse(frame.event);
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

  const parsed = getAgUiWireEventSchema().safeParse({
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
