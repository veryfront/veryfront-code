import type { ChatFinishReason, ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import type {
  ChatDynamicToolUiPart,
  ChatUiMessage,
  ChatUiMessageChunk,
  MessageMetadata,
} from "../chat/types.ts";
import { createAgUiRuntimeChatStreamEncoder } from "./ag-ui-runtime-chat-stream-encoder.ts";
import {
  mergeToolInputDelta,
  parseToolInputObject,
  streamDataStreamEvents,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";
import {
  normalizeChatMessageMetadata,
  normalizeChatUiMessageStream,
} from "../chat/chat-ui-message-helpers.ts";

export type ChatUiMessageStreamFinishPart = {
  type: "finish";
  finishReason: ChatFinishReason;
  rawFinishReason: ChatFinishReason;
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokenDetails: {
      noCacheTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails: {
      textTokens?: number;
      reasoningTokens?: number;
    };
  };
};

export type ChatUiMessageStreamFinish<TMessageMetadata = MessageMetadata> = {
  messages: Array<ChatUiMessage<TMessageMetadata>>;
  isContinuation: false;
  responseMessage: ChatUiMessage<TMessageMetadata>;
  isAborted: false;
  finishReason: ChatFinishReason;
};

export type ChatUiMessageStreamOptions<TMessageMetadata = MessageMetadata> = {
  generateMessageId?: () => string;
  sendReasoning?: boolean;
  onError?: (error: unknown) => string;
  messageMetadata?: (
    input: { part: ChatUiMessageStreamFinishPart },
  ) => TMessageMetadata | undefined;
  onFinish?: (finish: ChatUiMessageStreamFinish<TMessageMetadata>) => void | Promise<void>;
  onOrphanedToolInput?: (input: { toolCallId: string; inputText: string }) => void;
};

type OrderedTextBlock = {
  id: string;
  order: number;
  text: string;
};

type ToolPart = {
  toolCallId: string;
  toolName: string;
  order: number;
  inputText: string;
  input: Record<string, unknown>;
  state: "input-available" | "output-available" | "output-error";
  output?: unknown;
  errorText?: string;
};

type DataPart = {
  name: string;
  order: number;
  value: unknown;
};

type PendingToolDelta = {
  inputText: string;
  chunks: string[];
};

type FrameworkUiMessageState = {
  textBlocks: Map<string, OrderedTextBlock>;
  reasoningBlocks: Map<string, OrderedTextBlock>;
  toolParts: Map<string, ToolPart>;
  dataParts: DataPart[];
  pendingToolDeltas: Map<string, PendingToolDelta>;
  nextOrder: number;
};

function createFrameworkUiMessageState(): FrameworkUiMessageState {
  return {
    textBlocks: new Map(),
    reasoningBlocks: new Map(),
    toolParts: new Map(),
    dataParts: [],
    pendingToolDeltas: new Map(),
    nextOrder: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(event: ChatStreamEvent, key: string): string | undefined {
  const value = event[key as keyof ChatStreamEvent];
  return typeof value === "string" ? value : undefined;
}

function appendPendingToolDelta(
  state: FrameworkUiMessageState,
  toolCallId: string,
  inputTextDelta: string,
): void {
  const existing = state.pendingToolDeltas.get(toolCallId);
  if (existing) {
    existing.inputText = mergeToolInputDelta(existing.inputText, inputTextDelta);
    existing.chunks.push(inputTextDelta);
    return;
  }

  state.pendingToolDeltas.set(toolCallId, {
    inputText: inputTextDelta,
    chunks: [inputTextDelta],
  });
}

function trackPendingFrameworkToolInput(input: {
  state: FrameworkUiMessageState;
  materializedToolCallIds: Set<string>;
  event: Record<string, unknown> & { type: string };
}): void {
  const { state, materializedToolCallIds, event } = input;

  if (event.type === "tool-input-delta") {
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
    const inputTextDelta = typeof event.inputTextDelta === "string"
      ? event.inputTextDelta
      : typeof event.delta === "string"
      ? event.delta
      : "";
    if (toolCallId && inputTextDelta.length > 0 && !materializedToolCallIds.has(toolCallId)) {
      appendPendingToolDelta(state, toolCallId, inputTextDelta);
    }
    return;
  }

  if (event.type === "tool-input-start" || event.type === "tool-input-available") {
    if (typeof event.toolCallId === "string") {
      materializedToolCallIds.add(event.toolCallId);
      state.pendingToolDeltas.delete(event.toolCallId);
    }
  }
}

function getParsedStreamedToolInput(inputText: string): Record<string, unknown> | null {
  const normalizedInputText = stripLeadingEmptyObjectPlaceholder(inputText).trim();
  if (normalizedInputText.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalizedInputText);
    return isRecord(parsed) ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    return null;
  }
}

function observeChatStreamEvent(input: {
  event: ChatStreamEvent;
  responseMessageId: string;
  state: FrameworkUiMessageState;
}): void {
  const { event, responseMessageId, state } = input;

  switch (event.type) {
    case "text-start": {
      const id = event.id || responseMessageId;
      if (!state.textBlocks.has(id)) {
        state.textBlocks.set(id, { id, order: state.nextOrder, text: "" });
        state.nextOrder += 1;
      }
      return;
    }
    case "text-delta": {
      const id = event.id || responseMessageId;
      const existingBlock = state.textBlocks.get(id);
      if (existingBlock) {
        existingBlock.text += event.delta;
        return;
      }
      state.textBlocks.set(id, { id, order: state.nextOrder, text: event.delta });
      state.nextOrder += 1;
      return;
    }
    case "reasoning-start": {
      if (!state.reasoningBlocks.has(event.id)) {
        state.reasoningBlocks.set(event.id, { id: event.id, order: state.nextOrder, text: "" });
        state.nextOrder += 1;
      }
      return;
    }
    case "reasoning-delta": {
      const existingBlock = state.reasoningBlocks.get(event.id);
      if (existingBlock) {
        existingBlock.text += event.delta;
        return;
      }
      state.reasoningBlocks.set(event.id, {
        id: event.id,
        order: state.nextOrder,
        text: event.delta,
      });
      state.nextOrder += 1;
      return;
    }
    case "tool-input-start": {
      if (!state.toolParts.has(event.toolCallId)) {
        state.toolParts.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          order: state.nextOrder,
          inputText: "",
          input: {},
          state: "input-available",
        });
        state.nextOrder += 1;
      }

      const pendingToolDelta = state.pendingToolDeltas.get(event.toolCallId);
      if (!pendingToolDelta) {
        return;
      }

      const toolPart = state.toolParts.get(event.toolCallId);
      if (!toolPart) {
        return;
      }

      toolPart.inputText = pendingToolDelta.inputText;
      const parsedInput = getParsedStreamedToolInput(toolPart.inputText);
      if (parsedInput) {
        toolPart.input = parsedInput;
      }
      state.pendingToolDeltas.delete(event.toolCallId);
      return;
    }
    case "tool-input-delta": {
      const toolPart = state.toolParts.get(event.toolCallId);
      if (!toolPart) {
        appendPendingToolDelta(state, event.toolCallId, event.inputTextDelta);
        return;
      }
      toolPart.inputText = mergeToolInputDelta(toolPart.inputText, event.inputTextDelta);
      const parsedInput = getParsedStreamedToolInput(toolPart.inputText);
      if (parsedInput) {
        toolPart.input = parsedInput;
      }
      return;
    }
    case "tool-input-available": {
      const toolPart = state.toolParts.get(event.toolCallId);
      const input = parseToolInputObject(event.input);
      if (toolPart) {
        toolPart.toolName = event.toolName;
        toolPart.input = input;
        toolPart.state = "input-available";
      } else {
        state.toolParts.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          order: state.nextOrder,
          inputText: "",
          input,
          state: "input-available",
        });
        state.nextOrder += 1;
      }
      state.pendingToolDeltas.delete(event.toolCallId);
      return;
    }
    case "tool-output-available": {
      const toolPart = state.toolParts.get(event.toolCallId);
      if (!toolPart) {
        return;
      }
      toolPart.state = "output-available";
      toolPart.output = event.output;
      return;
    }
    case "tool-output-error":
    case "tool-input-error": {
      const toolPart = state.toolParts.get(event.toolCallId);
      if (toolPart) {
        toolPart.state = "output-error";
        toolPart.errorText = event.errorText;
        if ("input" in event && event.input !== undefined) {
          toolPart.input = parseToolInputObject(event.input);
        }
        return;
      }
      state.toolParts.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: getStringField(event, "toolName") ?? "unknown",
        order: state.nextOrder,
        inputText: "",
        input: "input" in event && event.input !== undefined
          ? parseToolInputObject(event.input)
          : {},
        state: "output-error",
        errorText: event.errorText,
      });
      state.nextOrder += 1;
      return;
    }
    default: {
      if (!event.type.startsWith("data-")) {
        return;
      }
      if (!("data" in event)) {
        return;
      }
      state.dataParts.push({
        name: event.type.slice("data-".length),
        order: state.nextOrder,
        value: event.data,
      });
      state.nextOrder += 1;
      return;
    }
  }
}

function getOrphanedToolInput(
  state: FrameworkUiMessageState,
  toolCallId: string,
): Record<string, unknown> {
  const pending = state.pendingToolDeltas.get(toolCallId);
  if (!pending) {
    return {};
  }

  const parsedInput = getParsedStreamedToolInput(pending.inputText);
  if (parsedInput) {
    return parsedInput;
  }

  return {
    __rawInputText: pending.inputText,
  };
}

function buildOrphanedToolInputErrorText(inputText: string): string {
  const normalizedInputText = inputText.trim();
  const preview = normalizedInputText.length > 160
    ? `${normalizedInputText.slice(0, 160)}...`
    : normalizedInputText;
  return preview.length > 0
    ? `Tool input started streaming before the tool lifecycle was established and never materialized into an executable tool call. Buffered args: ${preview}`
    : "Tool input started streaming before the tool lifecycle was established and never materialized into an executable tool call.";
}

function buildResponseMessageParts(state: FrameworkUiMessageState): ChatUiMessage["parts"] {
  const orderedParts: Array<{ order: number; part: ChatUiMessage["parts"][number] }> = [];

  for (const textBlock of state.textBlocks.values()) {
    if (textBlock.text.length === 0) {
      continue;
    }

    orderedParts.push({
      order: textBlock.order,
      part: {
        type: "text",
        text: textBlock.text,
      },
    });
  }

  for (const reasoningBlock of state.reasoningBlocks.values()) {
    if (reasoningBlock.text.length === 0) {
      continue;
    }

    orderedParts.push({
      order: reasoningBlock.order,
      part: {
        type: "reasoning",
        text: reasoningBlock.text,
      },
    });
  }

  for (const toolPart of state.toolParts.values()) {
    const basePart: Pick<
      ChatDynamicToolUiPart,
      "type" | "toolName" | "toolCallId" | "input"
    > = {
      type: "dynamic-tool",
      toolName: toolPart.toolName,
      toolCallId: toolPart.toolCallId,
      input: toolPart.input,
    };

    const part: ChatUiMessage["parts"][number] = toolPart.state === "output-available"
      ? {
        ...basePart,
        state: "output-available",
        output: toolPart.output,
      }
      : toolPart.state === "output-error"
      ? {
        ...basePart,
        state: "output-error",
        errorText: toolPart.errorText ?? "Tool execution failed",
      }
      : {
        ...basePart,
        state: "input-available",
      };

    orderedParts.push({
      order: toolPart.order,
      part,
    });
  }

  for (const dataPart of state.dataParts) {
    orderedParts.push({
      order: dataPart.order,
      part: {
        type: `data-${dataPart.name}`,
        data: dataPart.value,
      },
    });
  }

  return orderedParts.sort((left, right) => left.order - right.order).map((entry) => entry.part);
}

function buildFinishPart(finishReason: ChatFinishReason): ChatUiMessageStreamFinishPart {
  return {
    type: "finish",
    finishReason,
    rawFinishReason: finishReason,
    totalUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
    },
  };
}

function toUiChunk(event: ChatStreamEvent): ChatUiMessageChunk<MessageMetadata> | null {
  switch (event.type) {
    case "start":
      return {
        type: "start",
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.messageMetadata !== undefined
          ? { messageMetadata: normalizeChatMessageMetadata(event.messageMetadata) }
          : {}),
      };
    case "finish":
      return {
        type: "finish",
        ...(event.finishReason ? { finishReason: event.finishReason } : {}),
      };
    case "message-metadata":
      return {
        type: "message-metadata",
        messageMetadata: normalizeChatMessageMetadata(event.messageMetadata),
      };
    default:
      return event;
  }
}

export function createChatUiMessageStreamFromDataStream<TMessageMetadata = MessageMetadata>(
  input: { stream: ReadableStream<Uint8Array> },
  options: ChatUiMessageStreamOptions<TMessageMetadata> = {},
): AsyncIterable<ChatUiMessageChunk<MessageMetadata>> {
  const responseMessageId = options.generateMessageId?.() ?? crypto.randomUUID();
  const state = createFrameworkUiMessageState();
  const chatEventEncoder = createAgUiRuntimeChatStreamEncoder({
    responseMessageId,
    sendReasoning: options.sendReasoning,
    onError: options.onError,
  });
  const materializedToolCallIds = new Set<string>();
  let finishReason: ChatFinishReason = "stop";

  return normalizeChatUiMessageStream(
    (async function* () {
      const ensureStepStarted = function* (shouldStartStep: boolean) {
        if (shouldStartStep) {
          yield { type: "start-step" as const };
        }
      };

      yield {
        type: "start",
        messageId: responseMessageId,
      };

      for await (const event of streamDataStreamEvents(input.stream)) {
        trackPendingFrameworkToolInput({
          state,
          materializedToolCallIds,
          event,
        });
        const chatEvents = chatEventEncoder.encode(event);
        finishReason = chatEventEncoder.state.finishReason;
        for (const chatEvent of chatEvents) {
          observeChatStreamEvent({
            event: chatEvent,
            responseMessageId,
            state,
          });
          const chunk = toUiChunk(chatEvent);
          if (chunk) {
            yield chunk;
          }
        }
      }

      for (const [toolCallId, pendingToolDelta] of state.pendingToolDeltas.entries()) {
        yield* ensureStepStarted(!chatEventEncoder.state.isStepOpen);
        chatEventEncoder.state.isStepOpen = true;
        const toolInput = getOrphanedToolInput(state, toolCallId);
        const errorText = buildOrphanedToolInputErrorText(pendingToolDelta.inputText);

        options.onOrphanedToolInput?.({ toolCallId, inputText: pendingToolDelta.inputText });

        state.toolParts.set(toolCallId, {
          toolCallId,
          toolName: "unknown",
          order: state.nextOrder,
          inputText: pendingToolDelta.inputText,
          input: toolInput,
          state: "output-error",
          errorText,
        });
        state.nextOrder += 1;

        yield {
          type: "tool-input-error",
          toolCallId,
          toolName: "unknown",
          input: toolInput,
          errorText,
        };
      }
      state.pendingToolDeltas.clear();

      const finishPart = buildFinishPart(finishReason);
      const messageMetadata = options.messageMetadata?.({ part: finishPart });
      const responseMessage: ChatUiMessage<TMessageMetadata> = {
        id: responseMessageId,
        role: "assistant",
        parts: buildResponseMessageParts(state),
        ...(messageMetadata ? { metadata: messageMetadata } : {}),
      };

      await options.onFinish?.({
        messages: [responseMessage],
        isContinuation: false,
        responseMessage,
        isAborted: false,
        finishReason: finishPart.finishReason,
      });

      yield {
        type: "finish",
        finishReason,
      };
    })(),
  );
}
