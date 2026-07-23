import {
  mergeToolInputDelta,
  parseToolInputObject,
} from "#veryfront/agent/streaming/tool-input.ts";
import {
  formatToolErrorText,
  isCommentOnlySseFrame,
  isRecord,
  isSafeHttpUrl,
  mapFinishReason,
  normalizeNewlines,
  parseSerializedToolResult,
  splitSseFrames,
  toRenderableCustomChunk,
} from "./ag-ui-helpers.ts";
import type { ChatStreamEvent } from "./protocol.ts";
import type { ChatUiMessage, ChatUiMessagePart } from "./types.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

type JsonPatchOperation = {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
};

/** Accumulated state for one AG-UI tool call. */
export type ToolCallState = {
  toolName: string;
  argsText: string;
};

const DEFAULT_MAX_BUFFERED_CHARS = 1_048_576;
const DEFAULT_MAX_FRAME_CHARS = 524_288;
const DEFAULT_MAX_TOOL_INPUT_CHARS = 262_144;
const DEFAULT_MAX_TRACKED_TOOL_CALLS = 1_024;

/** Public API contract for AG-UI runtime tool call. */
export type AgUiRuntimeToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/** Message shape for AG-UI runtime. */
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

/** Event emitted for parsed sse. */
export type ParsedSseEvent = {
  id: number | null;
  event: string | null;
  data: string;
};

/** Event emitted for AG-UI decoded. */
export type AgUiDecodedEvent = {
  eventId: number | null;
  wireEvent: AgUiWireEvent;
  chatEvents: ChatStreamEvent[];
};

/** Public API contract for AG-UI decoded chunk. */
export type AgUiDecodedChunk = {
  events: AgUiDecodedEvent[];
  remainder: string;
};

/** Public API contract for AG-UI decoder validation mode. */
export type AgUiDecoderValidationMode = "permissive" | "strict";

/** State for AG-UI chat event decoder. */
export type AgUiChatEventDecoderState = {
  remainder: string;
  lastEventId: number;
  toolCalls: Map<string, ToolCallState>;
  reasoningFallbackIndex: number;
  activeFallbackReasoningPartId: string | null;
  validationMode: AgUiDecoderValidationMode;
  onInvalidJson: ((details: { eventName: string | null; dataLength: number }) => void) | null;
  maxBufferedChars: number;
  maxFrameChars: number;
  maxToolInputChars: number;
  maxTrackedToolCalls: number;
};

const AG_UI_WIRE_EVENT_NAMES = [
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
] as const;

const AG_UI_WIRE_EVENT_NAME_SET = new Set<string>(AG_UI_WIRE_EVENT_NAMES);

type AgUiWireEventNameLiteral = typeof AG_UI_WIRE_EVENT_NAMES[number];

/** Zod schema for get AG-UI run finished metadata. */
export const getAgUiRunFinishedMetadataSchema = defineSchema((v) =>
  v.object({
    provider: v.string().optional(),
    model: v.string().optional(),
    inputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    outputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    totalTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    cachedInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    cacheCreationInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
      .optional(),
    cacheReadInputTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    reasoningTokens: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    finishReason: v.string().optional(),
    providerRequestId: v.string().optional(),
  })
);

/** Zod schema for get AG-UI snapshot tool call. */
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

/** Zod schema for get AG-UI snapshot message. */
export const getAgUiSnapshotMessageSchema = defineSchema((v) =>
  v.discriminatedUnion("role", [
    v.object({
      id: v.string().min(1),
      role: v.literal("assistant"),
      content: v.string().optional(),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
      toolCalls: v.array(getAgUiSnapshotToolCallSchema()).optional(),
    }),
    v.object({
      id: v.string().min(1),
      role: v.literal("user"),
      content: v.union([v.string(), v.array(getAgUiUserInputContentSchema())]),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
    v.object({
      id: v.string().min(1),
      role: v.literal("tool"),
      toolCallId: v.string().min(1),
      content: v.string(),
      error: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
    v.object({
      id: v.string().min(1),
      role: v.literal("reasoning"),
      content: v.string(),
      name: v.string().optional(),
      encryptedValue: v.string().optional(),
    }),
  ])
);

/** Zod schema for get AG-UI wire event name. */
export const getAgUiWireEventNameSchema = defineSchema((v) => v.enum(AG_UI_WIRE_EVENT_NAMES));

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
    if (!currentMessage) {
      continue;
    }
    if (currentMessage.role === "user" || currentMessage.role === "system") {
      return;
    }
    if (currentMessage.role !== "assistant") continue;

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
}

/** Map AG-UI runtime messages to chat UI messages. */
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

/** Zod schema for get AG-UI wire event. */
export const getAgUiWireEventSchema = defineSchema((v) =>
  v.discriminatedUnion("eventName", [
    v.object({
      eventName: v.literal("RunStarted"),
      payload: v.object({
        runId: v.string().optional(),
        threadId: v.string().optional(),
        agentId: v.string().optional(),
        agentName: v.string().optional(),
        agent_avatar_url: v.string().url().refine(
          isSafeHttpUrl,
          "Must be an HTTP or HTTPS URL without credentials",
        ).optional(),
      }),
    }),
    v.object({
      eventName: v.literal("Custom"),
      payload: v.object({ name: v.string().min(1), value: v.unknown() }),
    }),
    v.object({
      eventName: v.literal("TextMessageStart"),
      payload: v.object({
        messageId: v.string().min(1),
        contentId: v.string().min(1),
        role: v.string().optional(),
      }),
    }),
    v.object({
      eventName: v.literal("TextMessageContent"),
      payload: v.object({
        messageId: v.string().min(1),
        contentId: v.string().min(1),
        delta: v.string(),
      }),
    }),
    v.object({
      eventName: v.literal("TextMessageEnd"),
      payload: v.object({
        messageId: v.string().min(1),
        contentId: v.string().min(1),
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

/** Public API contract for AG-UI run finished metadata. */
export type AgUiRunFinishedMetadata = InferSchema<
  ReturnType<typeof getAgUiRunFinishedMetadataSchema>
>;
/** Message shape for AG-UI snapshot. */
export type AgUiSnapshotMessage = InferSchema<ReturnType<typeof getAgUiSnapshotMessageSchema>>;
/** Public API contract for AG-UI wire event name. */
export type AgUiWireEventName = InferSchema<ReturnType<typeof getAgUiWireEventNameSchema>>;
/** Event emitted for AG-UI wire. */
export type AgUiWireEvent = InferSchema<ReturnType<typeof getAgUiWireEventSchema>>;

function getReasoningPartId(
  state: AgUiChatEventDecoderState,
  payload: { id?: string; messageId?: string },
  phase: "start" | "content" | "end",
): string {
  let resolvedId: string | null = null;
  if (typeof payload.id === "string" && payload.id.length > 0) {
    resolvedId = payload.id;
  } else if (typeof payload.messageId === "string" && payload.messageId.length > 0) {
    resolvedId = `agui-reasoning:${payload.messageId}`;
  }

  if (resolvedId) {
    state.activeFallbackReasoningPartId = phase === "end" ? null : resolvedId;
    return resolvedId;
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

function isAgUiWireEventName(value: string | null): value is AgUiWireEventNameLiteral {
  return typeof value === "string" && AG_UI_WIRE_EVENT_NAME_SET.has(value);
}

function hasStringField(payload: Record<string, unknown>, key: string): boolean {
  return typeof payload[key] === "string" && payload[key].length > 0;
}

function hasOptionalStringField(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === undefined || typeof payload[key] === "string";
}

function hasOptionalSnapshotStringField(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] === undefined || typeof payload[key] === "string";
}

function isValidSnapshotToolCall(value: unknown): boolean {
  if (!isRecord(value) || value.type !== "function" || !hasStringField(value, "id")) {
    return false;
  }
  if (!isRecord(value.function) || !hasStringField(value.function, "name")) {
    return false;
  }
  return typeof value.function.arguments === "string" &&
    hasOptionalSnapshotStringField(value, "encryptedValue");
}

function isValidUserSnapshotContent(value: unknown): boolean {
  if (typeof value === "string") {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((part) => {
    if (!isRecord(part)) return false;
    if (part.type === "text") return typeof part.text === "string";
    return part.type === "binary" && typeof part.mimeType === "string" &&
      hasOptionalSnapshotStringField(part, "id") &&
      hasOptionalSnapshotStringField(part, "url") &&
      hasOptionalSnapshotStringField(part, "data") &&
      hasOptionalSnapshotStringField(part, "filename");
  });
}

function isValidSnapshotMessage(value: unknown): boolean {
  if (!isRecord(value) || !hasStringField(value, "id")) {
    return false;
  }

  const optionalCommonFieldsAreValid = hasOptionalSnapshotStringField(value, "name") &&
    hasOptionalSnapshotStringField(value, "encryptedValue");
  if (!optionalCommonFieldsAreValid) return false;

  switch (value.role) {
    case "assistant":
      return hasOptionalSnapshotStringField(value, "content") &&
        (value.toolCalls === undefined ||
          (Array.isArray(value.toolCalls) && value.toolCalls.every(isValidSnapshotToolCall)));
    case "user":
      return isValidUserSnapshotContent(value.content);
    case "tool":
      return hasStringField(value, "toolCallId") && typeof value.content === "string" &&
        hasOptionalSnapshotStringField(value, "error");
    case "reasoning":
      return typeof value.content === "string";
    default:
      return false;
  }
}

function isValidStateDelta(value: unknown): boolean {
  if (isRecord(value)) return true;
  if (!Array.isArray(value)) return false;
  return value.every((operation) =>
    isRecord(operation) &&
    (operation.op === "add" || operation.op === "remove" || operation.op === "replace" ||
      operation.op === "move" || operation.op === "copy" || operation.op === "test") &&
    hasStringField(operation, "path") &&
    (operation.from === undefined || hasStringField(operation, "from"))
  );
}

function isValidRunFinishedMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const key of ["provider", "model", "finishReason", "providerRequestId"] as const) {
    if (!hasOptionalStringField(value, key)) return false;
  }
  for (
    const key of [
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cachedInputTokens",
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "reasoningTokens",
    ] as const
  ) {
    const field = value[key];
    if (
      field !== undefined &&
      (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0)
    ) {
      return false;
    }
  }
  return true;
}

function isValidAgUiPayload(
  eventName: AgUiWireEventNameLiteral,
  payload: Record<string, unknown>,
): boolean {
  switch (eventName) {
    case "RunStarted":
      return hasOptionalStringField(payload, "runId") &&
        hasOptionalStringField(payload, "threadId") &&
        hasOptionalStringField(payload, "agentId") &&
        hasOptionalStringField(payload, "agentName") &&
        (payload.agent_avatar_url === undefined ||
          (typeof payload.agent_avatar_url === "string" &&
            isSafeHttpUrl(payload.agent_avatar_url)));

    case "Custom":
      return hasStringField(payload, "name") && "value" in payload;

    case "TextMessageStart":
    case "TextMessageEnd":
      return hasStringField(payload, "messageId") &&
        hasStringField(payload, "contentId") &&
        hasOptionalStringField(payload, "role");

    case "TextMessageContent":
      return hasStringField(payload, "messageId") &&
        typeof payload.delta === "string" &&
        hasStringField(payload, "contentId");

    case "ToolCallStart":
      return hasStringField(payload, "toolCallId") && hasStringField(payload, "toolCallName");

    case "ToolCallArgs":
    case "ToolCallChunk":
      return hasStringField(payload, "toolCallId") && typeof payload.delta === "string";

    case "ToolCallEnd":
      return hasStringField(payload, "toolCallId");

    case "ToolCallResult":
      return hasStringField(payload, "toolCallId") &&
        (payload.messageId === undefined || hasStringField(payload, "messageId")) &&
        (payload.role === undefined || payload.role === "tool") &&
        (payload.isError === undefined || typeof payload.isError === "boolean");

    case "StateSnapshot":
      return isRecord(payload.snapshot);

    case "MessagesSnapshot":
      return Array.isArray(payload.messages) && payload.messages.every(isValidSnapshotMessage);

    case "ReasoningMessageStart":
    case "ReasoningMessageEnd":
      return hasOptionalStringField(payload, "messageId") &&
        hasOptionalStringField(payload, "id") &&
        hasOptionalStringField(payload, "role");

    case "ReasoningMessageContent":
      return typeof payload.delta === "string" &&
        hasOptionalStringField(payload, "messageId") &&
        hasOptionalStringField(payload, "id");

    case "StateDelta":
      return isValidStateDelta(payload.delta);

    case "RunFinished":
      return payload.metadata === undefined || isValidRunFinishedMetadata(payload.metadata);

    case "RunError":
      return hasOptionalStringField(payload, "message") &&
        hasOptionalStringField(payload, "code");
  }
}

function parseAgUiWireEventWithoutSchema(
  eventName: AgUiWireEventNameLiteral,
  payload: Record<string, unknown>,
  validationMode: AgUiDecoderValidationMode,
): AgUiWireEvent | null {
  if (isValidAgUiPayload(eventName, payload)) {
    return { eventName, payload } as AgUiWireEvent;
  }

  if (validationMode === "strict") {
    throw new Error(`Malformed AG-UI event payload for ${eventName}`);
  }

  return null;
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

  if (!isAgUiWireEventName(frame.event)) {
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
    if (input.validationMode === "strict") {
      throw new Error(`Malformed AG-UI event payload for ${frame.event}`);
    }
    return null;
  }

  return parseAgUiWireEventWithoutSchema(frame.event, payload, input.validationMode);
}

function mapWireEventToChatEvents(
  state: AgUiChatEventDecoderState,
  wireEvent: AgUiWireEvent,
): ChatStreamEvent[] {
  const textContentId =
    "contentId" in wireEvent.payload && typeof wireEvent.payload.contentId === "string"
      ? wireEvent.payload.contentId
      : undefined;

  switch (wireEvent.eventName) {
    case "RunStarted":
      return [{
        type: "start",
        messageMetadata: wireEvent.payload,
      }];

    case "TextMessageStart":
      return [{
        type: "text-start",
        id: wireEvent.payload.contentId,
        messageId: wireEvent.payload.messageId,
        ...(textContentId ? { contentId: textContentId } : {}),
      }];

    case "TextMessageContent":
      return [{
        type: "text-delta",
        id: wireEvent.payload.contentId,
        messageId: wireEvent.payload.messageId,
        ...(textContentId ? { contentId: textContentId } : {}),
        delta: wireEvent.payload.delta,
      }];

    case "TextMessageEnd":
      return [{
        type: "text-end",
        id: wireEvent.payload.contentId,
        messageId: wireEvent.payload.messageId,
        ...(textContentId ? { contentId: textContentId } : {}),
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
      if (
        !state.toolCalls.has(wireEvent.payload.toolCallId) &&
        state.toolCalls.size >= state.maxTrackedToolCalls
      ) {
        throw new RangeError(
          `AG-UI tracked tool calls exceed ${state.maxTrackedToolCalls}`,
        );
      }
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

      const argsText = mergeToolInputDelta(toolCall.argsText, wireEvent.payload.delta);
      if (argsText.length > state.maxToolInputChars) {
        state.toolCalls.delete(wireEvent.payload.toolCallId);
        throw new RangeError(
          `AG-UI tool input exceeds ${state.maxToolInputChars} characters`,
        );
      }
      toolCall.argsText = argsText;
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

      state.toolCalls.delete(wireEvent.payload.toolCallId);

      return [{
        type: "tool-input-available",
        toolCallId: wireEvent.payload.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.argsText.trim().length > 0 ? parseToolInputObject(toolCall.argsText) : {},
        providerExecuted: true,
      }];
    }

    case "ToolCallResult": {
      state.toolCalls.delete(wireEvent.payload.toolCallId);
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

      return [{
        type: "tool-output-available",
        toolCallId: wireEvent.payload.toolCallId,
        output: parsedResult,
        providerExecuted: true,
      }];
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
      state.toolCalls.clear();
      return [{
        type: "finish",
        ...(mapFinishReason(wireEvent.payload.metadata?.finishReason)
          ? { finishReason: mapFinishReason(wireEvent.payload.metadata?.finishReason) }
          : {}),
      }];

    case "RunError":
      state.toolCalls.clear();
      if (wireEvent.payload.code === "CANCELLED") {
        return [{ type: "abort" }];
      }

      return [{
        type: "error",
        errorText: "Conversation agent run failed",
      }];
  }
}

/** Event emitted for parse sse. */
export function parseSseEvent(raw: string): ParsedSseEvent {
  let id: number | null = null;
  let event: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("id:")) {
      const value = line.slice(3).trim();
      if (/^(?:0|[1-9]\d*)$/.test(value)) {
        const parsed = Number(value);
        if (Number.isSafeInteger(parsed)) {
          id = parsed;
        }
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

function resolvePositiveSafeInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

/** State for create AG-UI chat event decoder. */
export function createAgUiChatEventDecoderState(
  input: {
    lastEventId?: number;
    validationMode?: AgUiDecoderValidationMode;
    onInvalidJson?: (details: { eventName: string | null; dataLength: number }) => void;
    maxBufferedChars?: number;
    maxFrameChars?: number;
    maxToolInputChars?: number;
    maxTrackedToolCalls?: number;
  } = {},
): AgUiChatEventDecoderState {
  const lastEventId = input.lastEventId ?? -1;
  if (!Number.isSafeInteger(lastEventId) || lastEventId < -1) {
    throw new RangeError("lastEventId must be a safe integer greater than or equal to -1");
  }
  if (
    input.validationMode !== undefined && input.validationMode !== "permissive" &&
    input.validationMode !== "strict"
  ) {
    throw new TypeError("validationMode must be permissive or strict");
  }
  if (input.onInvalidJson !== undefined && typeof input.onInvalidJson !== "function") {
    throw new TypeError("onInvalidJson must be a function");
  }

  const maxBufferedChars = resolvePositiveSafeInteger(
    input.maxBufferedChars,
    DEFAULT_MAX_BUFFERED_CHARS,
    "maxBufferedChars",
  );
  const maxFrameChars = resolvePositiveSafeInteger(
    input.maxFrameChars,
    Math.min(DEFAULT_MAX_FRAME_CHARS, maxBufferedChars),
    "maxFrameChars",
  );
  if (maxFrameChars > maxBufferedChars) {
    throw new RangeError("maxFrameChars must not exceed maxBufferedChars");
  }

  return {
    remainder: "",
    lastEventId,
    toolCalls: new Map<string, ToolCallState>(),
    reasoningFallbackIndex: 0,
    activeFallbackReasoningPartId: null,
    validationMode: input.validationMode ?? "permissive",
    onInvalidJson: input.onInvalidJson ?? null,
    maxBufferedChars,
    maxFrameChars,
    maxToolInputChars: resolvePositiveSafeInteger(
      input.maxToolInputChars,
      DEFAULT_MAX_TOOL_INPUT_CHARS,
      "maxToolInputChars",
    ),
    maxTrackedToolCalls: resolvePositiveSafeInteger(
      input.maxTrackedToolCalls,
      DEFAULT_MAX_TRACKED_TOOL_CALLS,
      "maxTrackedToolCalls",
    ),
  };
}

function decodeAgUiFrames(
  state: AgUiChatEventDecoderState,
  frames: readonly string[],
): AgUiDecodedEvent[] {
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

  return events;
}

/** Decode AG-UI SSE chunk. */
export function decodeAgUiSseChunk(
  state: AgUiChatEventDecoderState,
  chunk: string,
): AgUiDecodedChunk {
  const normalizedChunk = normalizeNewlines(chunk);
  if (state.remainder.length + normalizedChunk.length > state.maxBufferedChars) {
    throw new RangeError(
      `AG-UI SSE buffer exceeds ${state.maxBufferedChars} characters`,
    );
  }
  const normalized = `${state.remainder}${normalizedChunk}`;
  const { frames, remainder } = splitSseFrames(normalized);
  if (remainder.length > state.maxFrameChars) {
    throw new RangeError(
      `AG-UI SSE frame exceeds ${state.maxFrameChars} characters`,
    );
  }
  for (const frame of frames) {
    if (frame.length > state.maxFrameChars) {
      throw new RangeError(
        `AG-UI SSE frame exceeds ${state.maxFrameChars} characters`,
      );
    }
  }
  state.remainder = remainder;

  return {
    events: decodeAgUiFrames(state, frames),
    remainder: state.remainder,
  };
}

/** Flush AG-UI SSE chunk. */
export function flushAgUiSseChunk(state: AgUiChatEventDecoderState): AgUiDecodedChunk {
  if (state.remainder.length === 0) {
    return { events: [], remainder: "" };
  }

  const frame = state.remainder;
  if (frame.length > state.maxFrameChars) {
    throw new RangeError(
      `AG-UI SSE frame exceeds ${state.maxFrameChars} characters`,
    );
  }
  state.remainder = "";
  return {
    events: decodeAgUiFrames(state, [frame]),
    remainder: "",
  };
}
