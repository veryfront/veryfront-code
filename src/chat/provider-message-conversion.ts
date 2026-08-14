/**
 * Provider message conversion.
 *
 * The single owner of turning a chat's replay history into the ordered message
 * list a provider sees. It asks Tool Replay Reconciliation which tool
 * occurrences are authoritative, maps each role's parts into provider content,
 * and settles into one ProviderModelMessage[].
 */
import { isRecord } from "./part-field-access.ts";
import type { JsonValue } from "./part-field-access.ts";
import {
  buildRawToolCallResultOutput,
  buildToolResultOutput,
  getFilePart,
  getRawToolCallPart,
  getRawToolResultPart,
  getToolPart,
  isProviderVisibleReasoningPart,
  isTextPart,
} from "./message-part-parsing.ts";
import {
  findProviderVisibleToolReplayMatches,
  isTransientToolState,
} from "./tool-replay-reconciliation.ts";
import type { ProviderVisibleToolReplayMatches } from "./tool-replay-reconciliation.ts";
import type { ChatProviderModelInputMessage } from "./provider-input-types.ts";
import {
  getProviderModelMessageSourceId,
  withProviderModelMessageSourceId,
} from "./conversation.ts";
import type { ChatToolResultPart, ProviderModelMessage } from "./types.ts";

type ProviderToolResultContent = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output:
    | {
      type: "json";
      value: JsonValue;
    }
    | {
      type: "error-text";
      value: string;
    };
};

function buildToolNameMap(parts: ReadonlyArray<unknown>): Map<string, string> {
  const toolNames = new Map<string, string>();

  for (const part of parts) {
    const toolPart = getToolPart(part);
    if (toolPart) {
      toolNames.set(toolPart.toolCallId, toolPart.toolName);
      continue;
    }

    const rawToolCall = getRawToolCallPart(part);
    if (!rawToolCall) {
      continue;
    }

    toolNames.set(rawToolCall.toolCallId, rawToolCall.toolName);
  }

  return toolNames;
}

function resolveRawToolResultPart(
  rawResult: NonNullable<ReturnType<typeof getRawToolResultPart>>,
  toolNamesById: ReadonlyMap<string, string>,
  knownToolNamesById: ReadonlyMap<string, string>,
  matchedToolName?: string,
): ProviderToolResultContent | null {
  const toolName = matchedToolName ?? rawResult.toolName ??
    toolNamesById.get(rawResult.toolCallId) ??
    knownToolNamesById.get(rawResult.toolCallId);
  if (!toolName) {
    return null;
  }

  return {
    type: "tool-result",
    toolCallId: rawResult.toolCallId,
    toolName,
    output: rawResult.output,
  };
}

function shouldSkipTransientToolCall(
  part: unknown,
  state: string | undefined,
  replayMatches: ProviderVisibleToolReplayMatches,
): boolean {
  return isTransientToolState(state) &&
    (!isRecord(part) || !replayMatches.preservedTransientToolParts.has(part));
}

function convertSystemMessage(message: ChatProviderModelInputMessage): ProviderModelMessage[] {
  const content = message.parts.flatMap((part) => (isTextPart(part) ? [part.text] : [])).join("");
  if (content.length === 0) {
    return [];
  }

  return [
    {
      role: "system",
      content,
    },
  ];
}

function convertUserMessage(message: ChatProviderModelInputMessage): ProviderModelMessage[] {
  const content: Array<
    { type: "text"; text: string } | {
      type: "file" | "image";
      mediaType: string;
      data: string;
      url: string;
      filename?: string;
      uploadId?: string;
      uploadPath?: string;
    }
  > = [];

  for (const part of message.parts) {
    if (isTextPart(part)) {
      if (part.text.length > 0) {
        content.push({ type: "text", text: part.text });
      }
      continue;
    }

    const filePart = getFilePart(part);
    if (filePart) {
      content.push(filePart);
    }
  }

  if (content.length === 0) {
    return [];
  }

  return [
    {
      role: "user",
      content,
    },
  ];
}

function convertAssistantMessage(
  message: ChatProviderModelInputMessage,
  knownToolNamesById: ReadonlyMap<string, string>,
  replayMatches: ProviderVisibleToolReplayMatches,
): ProviderModelMessage[] {
  const toolNamesById = buildToolNameMap(message.parts);
  const assistantContent: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
    | { type: "file" | "image"; mediaType: string; data: string; filename?: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
  > = [];
  const deferredAssistantContent: typeof assistantContent = [];
  const toolResults: ProviderToolResultContent[] = [];
  const pendingToolCallIds = new Set<string>();
  const messages: ProviderModelMessage[] = [];

  const flushAssistantMessage = (content: typeof assistantContent) => {
    if (content.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: [...content],
    });
    content.length = 0;
  };

  const flushToolMessage = () => {
    if (toolResults.length === 0) {
      return;
    }

    messages.push({
      role: "tool",
      content: [...toolResults],
    });
    toolResults.length = 0;
  };

  const pushAssistantPart = (
    part:
      | { type: "text"; text: string }
      | { type: "reasoning"; text?: string; signature?: string; redactedData?: string }
      | { type: "file" | "image"; mediaType: string; data: string; filename?: string }
      | { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> },
  ) => {
    if (part.type === "tool-call") {
      if (deferredAssistantContent.length > 0) {
        flushAssistantMessage(assistantContent);
        flushToolMessage();
        flushAssistantMessage(deferredAssistantContent);
      }

      assistantContent.push(part);
      pendingToolCallIds.add(part.toolCallId);
      return;
    }

    if (pendingToolCallIds.size > 0) {
      deferredAssistantContent.push(part);
      return;
    }

    if (toolResults.length > 0) {
      flushAssistantMessage(assistantContent);
      flushToolMessage();
      flushAssistantMessage(deferredAssistantContent);
    }

    assistantContent.push(part);
  };

  const pushToolResult = (part: ProviderToolResultContent) => {
    toolResults.push(part);
    pendingToolCallIds.delete(part.toolCallId);
  };

  const pushToolCall = (
    part: unknown,
    toolCall: {
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      state?: string;
    },
    resultOutput: ReturnType<typeof buildToolResultOutput>,
  ) => {
    if (shouldSkipTransientToolCall(part, toolCall.state, replayMatches)) {
      return;
    }

    if (isRecord(part) && replayMatches.supersededToolCallParts.has(part)) {
      return;
    }

    if (isRecord(part) && replayMatches.toolCallPartsStartingNewBatch.has(part)) {
      flushAssistantMessage(assistantContent);
      flushToolMessage();
      flushAssistantMessage(deferredAssistantContent);
    }

    pushAssistantPart({
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    });

    if (resultOutput) {
      pushToolResult({
        type: "tool-result",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: resultOutput,
      });
    }
  };

  for (const part of message.parts) {
    if (isTextPart(part)) {
      if (part.text.length > 0) {
        pushAssistantPart({ type: "text", text: part.text });
      }
      continue;
    }

    if (isProviderVisibleReasoningPart(part)) {
      pushAssistantPart({
        type: "reasoning",
        text: part.text,
        ...(typeof part.signature === "string" ? { signature: part.signature } : {}),
        ...(typeof part.redactedData === "string" ? { redactedData: part.redactedData } : {}),
      });
      continue;
    }

    const filePart = getFilePart(part);
    if (filePart) {
      pushAssistantPart(filePart);
      continue;
    }

    const toolPart = getToolPart(part);
    if (toolPart) {
      pushToolCall(part, toolPart, buildToolResultOutput(toolPart));
      continue;
    }

    const rawToolCall = getRawToolCallPart(part);
    if (rawToolCall) {
      const authoritativeResultFollows = isRecord(part) &&
        replayMatches.matchedToolCallParts.has(part);
      pushToolCall(
        part,
        rawToolCall,
        authoritativeResultFollows ? null : buildRawToolCallResultOutput(rawToolCall),
      );
      continue;
    }

    const rawToolResult = getRawToolResultPart(part);
    if (rawToolResult) {
      if (
        !isRecord(part) || !replayMatches.matchedToolResultParts.has(part) ||
        replayMatches.supersededToolResultParts.has(part)
      ) {
        continue;
      }

      const toolResult = resolveRawToolResultPart(
        rawToolResult,
        toolNamesById,
        knownToolNamesById,
        replayMatches.matchedToolResultNames.get(part),
      );
      if (toolResult) {
        pushToolResult(toolResult);
      }
    }
  }

  flushAssistantMessage(assistantContent);
  flushToolMessage();
  flushAssistantMessage(deferredAssistantContent);

  return messages;
}

function convertToolMessage(
  message: ChatProviderModelInputMessage,
  knownToolNamesById: ReadonlyMap<string, string>,
  replayMatches: ProviderVisibleToolReplayMatches,
): ProviderModelMessage[] {
  const toolNamesById = buildToolNameMap(message.parts);
  const toolResults: ChatToolResultPart[] = [];

  for (const part of message.parts) {
    const toolPart = getToolPart(part);
    if (toolPart) {
      const output = buildToolResultOutput(toolPart);
      if (output) {
        if (
          !isRecord(part) || !replayMatches.matchedToolResultParts.has(part) ||
          replayMatches.supersededToolResultParts.has(part)
        ) {
          continue;
        }

        toolResults.push({
          type: "tool-result",
          toolCallId: toolPart.toolCallId,
          toolName: toolPart.toolName,
          output,
        });
      }
      continue;
    }

    const rawResult = getRawToolResultPart(part);
    if (!rawResult) {
      continue;
    }
    if (
      !isRecord(part) || !replayMatches.matchedToolResultParts.has(part) ||
      replayMatches.supersededToolResultParts.has(part)
    ) {
      continue;
    }

    const toolResult = resolveRawToolResultPart(
      rawResult,
      toolNamesById,
      knownToolNamesById,
      replayMatches.matchedToolResultNames.get(part),
    );
    if (toolResult) {
      toolResults.push(toolResult);
    }
  }

  if (toolResults.length === 0) {
    return [];
  }

  return [{ role: "tool", content: toolResults }];
}

/** Convert UI messages to provider model messages. */
export function convertUiMessagesToProviderModelMessages(
  messages: readonly ChatProviderModelInputMessage[],
): ProviderModelMessage[] {
  const providerMessages: ProviderModelMessage[] = [];
  const knownToolNamesById = new Map<string, string>();
  const replayMatches = findProviderVisibleToolReplayMatches(messages);

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const [toolCallId, toolName] of buildToolNameMap(message.parts)) {
        knownToolNamesById.set(toolCallId, toolName);
      }
    }

    const converted = (() => {
      switch (message.role) {
        case "system":
          return convertSystemMessage(message);
        case "user":
          return convertUserMessage(message);
        case "assistant":
          return convertAssistantMessage(message, knownToolNamesById, replayMatches);
        case "tool":
          return convertToolMessage(message, knownToolNamesById, replayMatches);
        default:
          return [];
      }
    })();

    for (const rawProviderMessage of converted) {
      const providerMessage = withProviderModelMessageSourceId(rawProviderMessage, message.id);
      const previous = providerMessages.at(-1);
      if (previous?.role === "tool" && providerMessage.role === "tool") {
        providerMessages[providerMessages.length - 1] = withProviderModelMessageSourceId({
          role: "tool",
          content: [...previous.content, ...providerMessage.content],
        }, getProviderModelMessageSourceId(previous) ?? message.id);
        continue;
      }

      providerMessages.push(providerMessage);
    }
  }

  return providerMessages;
}
