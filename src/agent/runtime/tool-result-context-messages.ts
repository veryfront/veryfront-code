import { getToolResultError } from "#veryfront/tool/result.ts";
import type { Message, MessagePart, ToolResultPart } from "../types.ts";
import type { ToolResultContext } from "./tool-result-context.ts";

const hasOwn = Object.hasOwn;
const SKIPPED_TOOL_RESULT_CONTEXT_TOOLS = new Set([
  "load_skill",
  "tool_search",
  "get_tool_result",
]);

export interface ToolResultContextMessageTransformOptions {
  readonly skippedToolNames?: ReadonlySet<string>;
}

function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === "tool-result" && "result" in part;
}

function shouldSkipToolResult(
  part: Pick<ToolResultPart, "toolName">,
  skippedToolNames: ReadonlySet<string>,
): boolean {
  return skippedToolNames.has(part.toolName);
}

function transformPartForToolResultContext(
  part: MessagePart,
  context: ToolResultContext,
  skippedToolNames: ReadonlySet<string>,
): MessagePart {
  if (!isToolResultPart(part) || shouldSkipToolResult(part, skippedToolNames)) {
    return part;
  }

  const disclosure = context.discloseForModelContext({
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    result: part.result,
    isError: getToolResultError(part.result) !== undefined,
  });
  if (disclosure.kind === "inline") {
    return part;
  }

  return {
    ...part,
    result: disclosure.modelResult,
  };
}

export function createModelToolResultContextMessages(
  messages: readonly Message[],
  context: ToolResultContext,
  options: ToolResultContextMessageTransformOptions = {},
): Message[] {
  const skippedToolNames = options.skippedToolNames ?? SKIPPED_TOOL_RESULT_CONTEXT_TOOLS;
  const transformedMessages: Message[] = [];
  transformedMessages.length = messages.length;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    if (!hasOwn(messages, messageIndex)) continue;
    const message = messages[messageIndex]!;
    let changed = false;
    const parts: MessagePart[] = [];
    parts.length = message.parts.length;

    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      if (!hasOwn(message.parts, partIndex)) continue;
      const part = message.parts[partIndex]!;
      const transformed = transformPartForToolResultContext(part, context, skippedToolNames);
      parts[partIndex] = transformed;
      if (transformed !== part) {
        changed = true;
      }
    }

    transformedMessages[messageIndex] = changed ? { ...message, parts } : message;
  }

  return transformedMessages;
}
