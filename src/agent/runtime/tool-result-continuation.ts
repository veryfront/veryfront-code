import { type Message, type MessagePart, type ToolResultPart } from "../types.ts";
import { stripLeadingEmptyObjectPlaceholder } from "../streaming/data-stream.ts";
import type {
  ChatStreamState,
  StreamingToolCall,
  StreamingToolResult,
} from "./chat-stream-handler.ts";
import { parseToolArgs } from "./tool-helpers.ts";
import type { RuntimeGenerateToolResult, RuntimeToolSet } from "./runtime-tool-types.ts";

export { getToolResultError } from "#veryfront/tool/result.ts";

export function createToolResultMessage(
  toolCallId: string,
  toolName: string,
  result: unknown,
  providerExecuted = false,
): Message {
  return {
    id: `tool_${toolCallId}`,
    role: "tool",
    parts: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        result,
        ...(providerExecuted ? { providerExecuted: true } : {}),
      },
    ],
    timestamp: Date.now(),
  };
}

export function createToolErrorMessage(
  toolCallId: string,
  toolName: string,
  error: string,
): Message {
  return {
    id: `tool_error_${toolCallId}`,
    role: "tool",
    parts: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        result: { error },
      },
    ],
    timestamp: Date.now(),
  };
}

export function getProviderExecutedToolNames(runtimeTools: RuntimeToolSet | undefined): string[] {
  if (!runtimeTools) {
    return [];
  }

  return Object.entries(runtimeTools).flatMap(([toolName, definition]) => {
    if (
      definition &&
      typeof definition === "object" &&
      "type" in definition &&
      definition.type === "provider"
    ) {
      return [toolName];
    }

    return [];
  });
}

export function collectFinalStreamToolResults(
  state: Pick<ChatStreamState, "toolResults">,
): Map<string, StreamingToolResult> {
  const finalToolResults = new Map<string, StreamingToolResult>();

  for (const toolResult of state.toolResults) {
    if (toolResult.preliminary === true) {
      continue;
    }

    finalToolResults.set(toolResult.toolCallId, toolResult);
  }

  return finalToolResults;
}

export function collectPersistedToolResults(
  messages: Message[],
): Map<string, ToolResultPart> {
  const persistedToolResults = new Map<string, ToolResultPart>();

  for (const message of messages) {
    if (message.role !== "tool") {
      continue;
    }

    for (const part of message.parts) {
      if (!isToolResultPart(part)) {
        continue;
      }

      persistedToolResults.set(part.toolCallId, part);
    }
  }

  return persistedToolResults;
}

export function collectGeneratedToolResults(
  toolResults: RuntimeGenerateToolResult[] | undefined,
): Map<string, RuntimeGenerateToolResult> {
  const generatedToolResults = new Map<string, RuntimeGenerateToolResult>();

  for (const toolResult of toolResults ?? []) {
    generatedToolResults.set(toolResult.toolCallId, toolResult);
  }

  return generatedToolResults;
}

export function hasSubstantiveAssistantText(text: string | undefined): boolean {
  return typeof text === "string" && text.trim().length > 0;
}

export function isClientRecoverablePlaceholderToolCall(
  toolCall: Pick<StreamingToolCall, "arguments" | "inputAvailable" | "providerExecuted">,
): boolean {
  return toolCall.providerExecuted !== true && isRecoverablePlaceholderToolCall(toolCall);
}

export function shouldRecoverPlaceholderToolCall(
  state: Pick<ChatStreamState, "accumulatedText">,
  toolCall: Pick<StreamingToolCall, "arguments" | "inputAvailable" | "providerExecuted">,
): boolean {
  return !hasSubstantiveAssistantText(state.accumulatedText) &&
    isClientRecoverablePlaceholderToolCall(toolCall);
}

export function shouldOmitRecoverablePlaceholderToolCall(
  state: Pick<ChatStreamState, "accumulatedText">,
  toolCall: Pick<StreamingToolCall, "arguments" | "inputAvailable" | "providerExecuted">,
): boolean {
  return hasSubstantiveAssistantText(state.accumulatedText) &&
    isClientRecoverablePlaceholderToolCall(toolCall);
}

export function shouldContinueAfterToolStep(options: {
  finishReason: string | null | undefined;
  toolCalls: Iterable<{
    toolCallId: string;
    providerExecuted?: boolean;
    supportsDeferredResults?: boolean;
  }>;
  toolResultIds: ReadonlySet<string>;
}): boolean {
  if (
    options.finishReason !== "tool-calls" && options.finishReason !== "pause_turn" &&
    options.finishReason !== "stop"
  ) {
    return false;
  }

  const toolCalls = [...options.toolCalls];
  if (toolCalls.length === 0) return false;

  // Provider-owned calls are terminal for this model response. Replaying them
  // would bill and execute the same server tool again because provider-owned
  // call/result history is intentionally omitted from subsequent prompts.
  // A missing result is also terminal (and is surfaced as an error by the
  // runtime bridge), never a successful reason to continue.
  for (const toolCall of toolCalls) {
    if (
      toolCall.providerExecuted === true &&
      !options.toolResultIds.has(toolCall.toolCallId) &&
      !(toolCall.supportsDeferredResults === true &&
        (options.finishReason === "tool-calls" || options.finishReason === "pause_turn"))
    ) {
      return false;
    }
  }

  return toolCalls.some((toolCall) => toolCall.providerExecuted !== true);
}

export function shouldContinueAfterStreamStep(
  state:
    & Pick<ChatStreamState, "accumulatedText" | "finishReason" | "toolCalls" | "toolResults">
    & Partial<Pick<ChatStreamState, "suppressedToolCalls">>,
): boolean {
  if (!state.toolCalls.size) {
    return state.finishReason === "tool-calls" && Boolean(state.suppressedToolCalls?.length);
  }

  const streamedToolCalls = Array.from(state.toolCalls.values());
  const hasIncompleteToolCall = streamedToolCalls.some(isStreamedToolCallIncomplete);
  const hasFinalizedClientToolCall = streamedToolCalls.some((toolCall) =>
    toolCall.inputAvailable === true && toolCall.providerExecuted !== true
  );
  // A non-finalized call whose only accumulated arguments are a bare
  // empty-object placeholder is provisional streamed input the model never
  // committed. The runtime can recover by re-calling the model only before the
  // assistant has produced final text, so it must not block earlier
  // continuation like a truncated partial-JSON call does.
  const hasIncompleteDeadToolCall = streamedToolCalls.some(
    (toolCall) =>
      isStreamedToolCallIncomplete(toolCall) &&
      !isRecoverablePlaceholderToolCall(toolCall),
  );
  const hasRecoverablePlaceholderToolCall = streamedToolCalls.some(
    (toolCall) => shouldRecoverPlaceholderToolCall(state, toolCall),
  );

  if (state.finishReason === "tool-calls") {
    if (hasIncompleteDeadToolCall) {
      return false;
    }
    if (hasRecoverablePlaceholderToolCall && !hasFinalizedClientToolCall) {
      return true;
    }
    if (hasIncompleteToolCall) return false;
  }

  if (
    state.finishReason !== "tool-calls" && state.finishReason !== "pause_turn" &&
    state.finishReason !== "stop"
  ) {
    return false;
  }

  const finalToolResults = collectFinalStreamToolResults(state);
  return shouldContinueAfterToolStep({
    finishReason: state.finishReason,
    toolCalls: Array.from(state.toolCalls.values(), (toolCall) => ({
      toolCallId: toolCall.id,
      ...(toolCall.providerExecuted === true ? { providerExecuted: true } : {}),
      ...(toolCall.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
    })),
    toolResultIds: new Set(finalToolResults.keys()),
  });
}

export function captureStreamedToolCallInput(
  toolCall: Pick<StreamingToolCall, "arguments">,
): {
  args: Record<string, unknown>;
  inputText?: string;
  parseError?: string;
} {
  const { args, error } = parseToolArgs(toolCall.arguments);
  return {
    args,
    ...(toolCall.arguments.length > 0 ? { inputText: toolCall.arguments } : {}),
    ...(error ? { parseError: error } : {}),
  };
}

export function isStreamedToolCallIncomplete(
  toolCall: Pick<StreamingToolCall, "inputAvailable">,
): boolean {
  return toolCall.inputAvailable !== true;
}

export function isRecoverablePlaceholderToolCall(
  toolCall: Pick<StreamingToolCall, "inputAvailable" | "arguments">,
): boolean {
  if (!isStreamedToolCallIncomplete(toolCall)) {
    return false;
  }
  const stripped = stripLeadingEmptyObjectPlaceholder(toolCall.arguments);
  return stripped === "" || stripped === "{}";
}

export type StreamedToolCallMaterialization =
  | { readonly kind: "complete"; readonly part: MessagePart }
  | {
    readonly kind: "parse-error";
    readonly part: MessagePart;
    readonly parseError: string;
  }
  | {
    readonly kind: "incomplete";
    readonly part: MessagePart;
    readonly partialArgumentsLength: number;
    readonly partialArgumentsPreview: string;
  };

export function materializeStreamedToolCall(
  tc: StreamingToolCall,
): StreamedToolCallMaterialization {
  const providerToolMetadata: {
    providerExecuted?: true;
    supportsDeferredResults?: true;
  } = {
    ...(tc.providerExecuted === true ? { providerExecuted: true } : {}),
    ...(tc.supportsDeferredResults === true ? { supportsDeferredResults: true } : {}),
  };
  const basePart: MessagePart & {
    providerExecuted?: true;
    supportsDeferredResults?: true;
  } = {
    type: `tool-${tc.name}`,
    toolCallId: tc.id,
    toolName: tc.name,
    args: {},
    ...(tc.arguments.length > 0 ? { inputText: tc.arguments } : {}),
    ...providerToolMetadata,
  };

  if (isStreamedToolCallIncomplete(tc)) {
    return {
      kind: "incomplete",
      part: basePart,
      partialArgumentsLength: tc.arguments.length,
      partialArgumentsPreview: tc.arguments.slice(0, 200),
    };
  }

  const capturedInput = captureStreamedToolCallInput(tc);
  const part: MessagePart & {
    providerExecuted?: true;
    supportsDeferredResults?: true;
  } = {
    type: `tool-${tc.name}`,
    toolCallId: tc.id,
    toolName: tc.name,
    args: capturedInput.args,
    ...(capturedInput.inputText ? { inputText: capturedInput.inputText } : {}),
    ...providerToolMetadata,
  };

  if (capturedInput.parseError) {
    return { kind: "parse-error", part, parseError: capturedInput.parseError };
  }
  return { kind: "complete", part };
}

export function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === "tool-result" && "result" in part;
}
