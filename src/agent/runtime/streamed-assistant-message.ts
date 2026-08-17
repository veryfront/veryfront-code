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
 * Empty counts as absent for every field. `reasoning-end` accepts a signature
 * or redacted payload on `typeof … === "string"`, so `""` is reachable, and
 * the matching SSE emission already treats it as absent. Keeping the same rule
 * here is what stops the persisted message from disagreeing with the wire.
 *
 * This is the single definition of "persisted reasoning". The runtime reuses
 * it to decide whether an interrupted local tool batch may be replayed — a
 * replay re-emits the step's reasoning, which duplicates whatever this
 * predicate kept. Adding a field to `StreamingReasoningPart` therefore has to
 * change this one function, not two copies of it.
 */
export function isPersistedReasoningPart(part: StreamingReasoningPart): boolean {
  return part.text.length > 0 ||
    (part.signature?.length ?? 0) > 0 ||
    (part.redactedData?.length ?? 0) > 0;
}

export function buildStreamedAssistantMessage(
  state: Pick<
    ChatStreamState,
    "accumulatedText" | "reasoningParts" | "toolCalls" | "providerMetadata"
  >,
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
      ...(reasoningPart.signature ? { signature: reasoningPart.signature } : {}),
      ...(reasoningPart.redactedData ? { redactedData: reasoningPart.redactedData } : {}),
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
    ...(state.providerMetadata ? { providerOptions: state.providerMetadata } : {}),
  };
}
