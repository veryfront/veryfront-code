import type { Message, MessagePart } from "../types.ts";
import type { ChatStreamState } from "./chat-stream-handler.ts";
import { materializeStreamedToolCall } from "./tool-result-continuation.ts";

export interface StreamedAssistantMessageIdentity {
  id: string;
  timestamp: number;
}

export function buildStreamedAssistantMessage(
  state: Pick<ChatStreamState, "accumulatedText" | "reasoningParts" | "toolCalls">,
  identity: StreamedAssistantMessageIdentity,
): Message {
  const parts: MessagePart[] = [];

  for (const reasoningPart of state.reasoningParts) {
    if (
      reasoningPart.text.length === 0 &&
      !reasoningPart.signature &&
      !reasoningPart.redactedData
    ) {
      continue;
    }
    parts.push({
      type: "reasoning",
      ...(reasoningPart.text.length > 0 ? { text: reasoningPart.text } : {}),
      ...(reasoningPart.signature ? { signature: reasoningPart.signature } : {}),
      ...(reasoningPart.redactedData ? { redactedData: reasoningPart.redactedData } : {}),
    });
  }

  if (state.accumulatedText) {
    parts.push({ type: "text", text: state.accumulatedText });
  }

  for (const toolCall of state.toolCalls.values()) {
    parts.push(materializeStreamedToolCall(toolCall).part);
  }

  return {
    id: identity.id,
    role: "assistant",
    parts,
    timestamp: identity.timestamp,
  };
}
