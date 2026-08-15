import type { Message, MessagePart } from "../types.ts";
import type { ChatStreamState, StreamingReasoningPart } from "./chat-stream-handler.ts";
import {
  materializeStreamedToolCall,
  shouldOmitRecoverablePlaceholderToolCall,
} from "./tool-result-continuation.ts";

export interface StreamedAssistantMessageIdentity {
  id: string;
  timestamp: number;
}

/**
 * Whether this reasoning part is kept in the assistant message, and so has
 * already been exposed to the client and written to history. A part carrying
 * no text, no signature and no redacted data is an id-only shell from a
 * `reasoning-start` that never received deltas; it is dropped.
 *
 * This is the single definition of "persisted reasoning". The runtime reuses
 * it to decide whether an interrupted local tool batch may be replayed — a
 * replay re-emits the step's reasoning, which duplicates whatever this
 * predicate kept. Adding a field to `StreamingReasoningPart` therefore has to
 * change this one function, not two copies of it.
 */
export function isPersistedReasoningPart(part: StreamingReasoningPart): boolean {
  return part.text.length > 0 ||
    part.signature !== undefined ||
    part.redactedData !== undefined;
}

export function buildStreamedAssistantMessage(
  state: Pick<ChatStreamState, "accumulatedText" | "reasoningParts" | "toolCalls">,
  identity: StreamedAssistantMessageIdentity,
  options: { preserveRecoverablePlaceholderToolCalls?: boolean } = {},
): Message {
  const parts: MessagePart[] = [];

  for (const reasoningPart of state.reasoningParts) {
    if (!isPersistedReasoningPart(reasoningPart)) {
      continue;
    }
    parts.push({
      type: "reasoning",
      ...(reasoningPart.text.length > 0 ? { text: reasoningPart.text } : {}),
      ...(reasoningPart.signature !== undefined ? { signature: reasoningPart.signature } : {}),
      ...(reasoningPart.redactedData !== undefined
        ? { redactedData: reasoningPart.redactedData }
        : {}),
    });
  }

  if (state.accumulatedText) {
    parts.push({ type: "text", text: state.accumulatedText });
  }

  for (const toolCall of state.toolCalls.values()) {
    if (
      options.preserveRecoverablePlaceholderToolCalls !== true &&
      shouldOmitRecoverablePlaceholderToolCall(state, toolCall)
    ) {
      continue;
    }
    parts.push(materializeStreamedToolCall(toolCall).part);
  }

  return {
    id: identity.id,
    role: "assistant",
    parts,
    timestamp: identity.timestamp,
  };
}
