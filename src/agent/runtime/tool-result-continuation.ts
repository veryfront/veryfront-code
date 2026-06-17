import { type Message, type MessagePart, type ToolResultPart } from "../types.ts";
import { stripLeadingEmptyObjectPlaceholder } from "../streaming/data-stream.ts";
import type {
  ChatStreamState,
  StreamingToolCall,
  StreamingToolResult,
} from "./chat-stream-handler.ts";
import { parseToolArgs } from "./tool-helpers.ts";
import { stringifyToolError } from "./error-utils.ts";
import type { RuntimeGenerateToolResult, RuntimeToolSet } from "./runtime-tool-types.ts";

export function getToolResultError(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("error" in result)) {
    return undefined;
  }

  return stringifyToolError(result.error);
}

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
  const hasProviderExecutedToolCall = streamedToolCalls.some((toolCall) =>
    toolCall.providerExecuted === true
  );
  // A non-finalized call whose only accumulated arguments are a bare
  // empty-object placeholder is provisional streamed input the model never
  // committed. The runtime can recover by re-calling the model, so it must not
  // block continuation like a truncated partial-JSON call does.
  const hasIncompleteDeadToolCall = streamedToolCalls.some(
    (toolCall) =>
      isStreamedToolCallIncomplete(toolCall) &&
      !isRecoverablePlaceholderToolCall(toolCall),
  );
  const hasRecoverablePlaceholderToolCall = streamedToolCalls.some(
    isRecoverablePlaceholderToolCall,
  );

  if (state.finishReason === "tool-calls") {
    if (hasIncompleteDeadToolCall) {
      return false;
    }
    if (hasProviderExecutedToolCall && !hasFinalizedClientToolCall) {
      return false;
    }
    if (hasRecoverablePlaceholderToolCall && !hasFinalizedClientToolCall) {
      return true;
    }
    return !hasIncompleteToolCall && hasFinalizedClientToolCall;
  }

  if (state.finishReason !== "stop") {
    return false;
  }

  if (state.accumulatedText.trim().length > 0) {
    return false;
  }

  const finalToolResults = collectFinalStreamToolResults(state);
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
