import type { Message, MessagePart } from "../types.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import {
  materializeStreamedToolCall,
  shouldOmitRecoverablePlaceholderToolCall,
} from "./tool-result-continuation.ts";
import { attachProviderReplaySidecar } from "./provider-replay.ts";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";

export interface StreamedAssistantMessageIdentity {
  id: string;
  timestamp: number;
}

export function buildStreamedAssistantMessage(
  state: Pick<
    ChatStreamState,
    | "accumulatedText"
    | "reasoningParts"
    | "toolCalls"
    | "providerBlocks"
    | "providerReplayOrder"
  >,
  identity: StreamedAssistantMessageIdentity,
): Message {
  const parts: MessagePart[] = [];
  const providerBlocks: RuntimeProviderBlock[] = [];
  const providerBlockPositions: number[] = [];
  const replayOrder = state.providerReplayOrder ?? [
    ...state.reasoningParts.map((part) => ({
      type: "reasoning" as const,
      ...part,
    })),
    ...(state.providerBlocks ?? []),
    ...(state.accumulatedText ? [{ type: "text" as const, text: state.accumulatedText }] : []),
    ...[...state.toolCalls.keys()].map((toolCallId) => ({
      type: "tool-call" as const,
      toolCallId,
    })),
  ];

  for (const replayPart of replayOrder) {
    if (replayPart.type === "provider-block") {
      providerBlocks.push(replayPart);
      providerBlockPositions.push(parts.length + providerBlocks.length - 1);
      continue;
    }
    if (replayPart.type === "reasoning") {
      if (
        replayPart.text.length === 0 &&
        !replayPart.signature &&
        !replayPart.redactedData
      ) {
        continue;
      }
      parts.push({
        type: "reasoning",
        ...(replayPart.text.length > 0 ? { text: replayPart.text } : {}),
        ...(replayPart.signature ? { signature: replayPart.signature } : {}),
        ...(replayPart.redactedData ? { redactedData: replayPart.redactedData } : {}),
      });
      continue;
    }
    if (replayPart.type === "text") {
      parts.push({ type: "text", text: replayPart.text });
      continue;
    }
    const toolCall = state.toolCalls.get(replayPart.toolCallId);
    if (toolCall && !shouldOmitRecoverablePlaceholderToolCall(state, toolCall)) {
      parts.push(materializeStreamedToolCall(toolCall).part);
    }
  }

  const message: Message = {
    id: identity.id,
    role: "assistant",
    parts,
    timestamp: identity.timestamp,
  };
  return providerBlocks.length > 0
    ? attachProviderReplaySidecar(message, {
      providerBlocks,
      providerBlockPositions,
    })
    : message;
}
