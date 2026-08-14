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

export function shouldOmitRecoverablePlaceholderToolCall(
  state: Pick<ChatStreamState, "accumulatedText">,
  toolCall: Pick<StreamingToolCall, "arguments" | "inputAvailable" | "providerExecuted">,
): boolean {
  return hasSubstantiveAssistantText(state.accumulatedText) &&
    isClientRecoverablePlaceholderToolCall(toolCall);
}

export function shouldContinueAfterStreamStep(
  state:
    & Pick<ChatStreamState, "accumulatedText" | "finishReason" | "toolCalls" | "toolResults">
    & Partial<Pick<ChatStreamState, "suppressedToolCalls">>,
  options: { recoverInterruptedToolCalls?: boolean } = {},
): boolean {
  const hasAssistantText = hasSubstantiveAssistantText(state.accumulatedText);

  if (!state.toolCalls.size) {
    return state.finishReason === "tool-calls" && Boolean(state.suppressedToolCalls?.length);
  }

  const streamedToolCalls = Array.from(state.toolCalls.values());
  const hasIncompleteToolCall = streamedToolCalls.some(isStreamedToolCallIncomplete);
  const hasFinalizedClientToolCall = streamedToolCalls.some((toolCall) =>
    toolCall.inputAvailable === true && toolCall.providerExecuted !== true
  );
  const hasProviderExecutedToolCall = streamedToolCalls.some((toolCall) =>
    toolCall.providerExecuted === true
  );
  const finalToolResults = collectFinalStreamToolResults(state);
  const hasUnresolvedProviderToolCall = streamedToolCalls.some(
    (toolCall) => toolCall.providerExecuted === true && !finalToolResults.has(toolCall.id),
  );
  const hasInterruptedClientToolCall = streamedToolCalls.some(isInterruptedClientToolCall);
  const hasInterruptedProviderToolCall = streamedToolCalls.some(
    (toolCall) =>
      toolCall.providerExecuted === true &&
      isStreamedToolCallIncomplete(toolCall),
  );
  const hasFinalizedClientToolResult = streamedToolCalls.some(
    (toolCall) =>
      toolCall.providerExecuted !== true &&
      finalToolResults.has(toolCall.id),
  );
  const canRecoverInterruptedClientToolCall = options.recoverInterruptedToolCalls === true &&
    hasInterruptedClientToolCall &&
    !hasInterruptedProviderToolCall &&
    !hasUnresolvedProviderToolCall &&
    !hasFinalizedClientToolResult;

  if (state.finishReason === "tool-calls") {
    if (hasIncompleteToolCall) {
      return canRecoverInterruptedClientToolCall;
    }
    if (hasProviderExecutedToolCall && !hasFinalizedClientToolCall) {
      return false;
    }
    return hasFinalizedClientToolCall;
  }

  if (state.finishReason !== "stop") {
    return false;
  }

  if (hasIncompleteToolCall) {
    return canRecoverInterruptedClientToolCall;
  }

  if (hasAssistantText) {
    return false;
  }

  if (!finalToolResults.size) {
    for (const toolCall of state.toolCalls.values()) {
      if (toolCall.inputAvailable !== true || toolCall.providerExecuted === true) {
        return false;
      }
    }
    return true;
  }

  for (const [toolCallId, toolCall] of state.toolCalls) {
    const toolResult = finalToolResults.get(toolCallId);
    if (!toolResult) {
      return false;
    }

    if (toolCall.providerExecuted !== true && toolResult.providerExecuted !== true) {
      return false;
    }
  }

  return true;
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

export function isInterruptedClientToolCall(
  toolCall: Pick<
    StreamingToolCall,
    "arguments" | "inputAvailable" | "providerExecuted"
  >,
): boolean {
  // Provider-executed calls have a separate terminalization path. Only local
  // calls can be safely turned into a model-visible failed batch and retried.
  return toolCall.providerExecuted !== true &&
    isStreamedToolCallIncomplete(toolCall);
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
  const providerExecutedPart: { providerExecuted?: true } = tc.providerExecuted === true
    ? { providerExecuted: true }
    : {};
  const basePart: MessagePart & { providerExecuted?: true } = {
    type: `tool-${tc.name}`,
    toolCallId: tc.id,
    toolName: tc.name,
    args: {},
    ...(tc.arguments.length > 0 ? { inputText: tc.arguments } : {}),
    ...providerExecutedPart,
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
  const part: MessagePart & { providerExecuted?: true } = {
    type: `tool-${tc.name}`,
    toolCallId: tc.id,
    toolName: tc.name,
    args: capturedInput.args,
    ...(capturedInput.inputText ? { inputText: capturedInput.inputText } : {}),
    ...providerExecutedPart,
  };

  if (capturedInput.parseError) {
    return { kind: "parse-error", part, parseError: capturedInput.parseError };
  }
  return { kind: "complete", part };
}

export function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === "tool-result" && "result" in part;
}
