import type { Message, MessagePart, ToolResultPart } from "../types.ts";
import type {
  ChatStreamState,
  StreamingToolCall,
  StreamingToolResult,
} from "./chat-stream-handler.ts";
import { parseToolArgs } from "./tool-helpers.ts";
import type { RuntimeGenerateToolResult } from "./runtime-tool-types.ts";

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

function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === "tool-result" && "result" in part;
}
