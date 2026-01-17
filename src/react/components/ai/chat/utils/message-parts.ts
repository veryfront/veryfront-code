/**
 * Message Parts Utilities
 * @module ai/react/components/chat/utils/message-parts
 */

import type {
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "@veryfront/agent/react";

/** Get text content from UIMessage parts */
export function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is UIMessagePart & { type: "text" } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Check if a part is a tool part */
export function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  return (part.type.startsWith("tool-") && part.type !== "tool-result") ||
    part.type === "dynamic-tool";
}

/** Check if a part is a reasoning part */
export function isReasoningPart(
  part: UIMessagePart,
): part is { type: "reasoning"; text: string; state?: string } {
  return part.type === "reasoning";
}

/**
 * Part group types for ordered rendering
 */
export type PartGroup =
  | { type: "text"; content: string }
  | { type: "tool"; tool: ToolUIPart | DynamicToolUIPart }
  | { type: "reasoning"; text: string; isStreaming: boolean };

/**
 * Group consecutive parts for ordered rendering
 * Returns an array of groups, each containing either consecutive text parts, a tool part, or a reasoning part
 */
export function groupPartsInOrder(parts: UIMessagePart[]): PartGroup[] {
  const groups: PartGroup[] = [];
  let currentTextGroup: string[] = [];

  const flushText = (): void => {
    if (currentTextGroup.length > 0) {
      groups.push({ type: "text", content: currentTextGroup.join("") });
      currentTextGroup = [];
    }
  };

  for (const part of parts) {
    if (part.type === "text") {
      currentTextGroup.push(part.text);
    } else if (isToolPart(part)) {
      flushText();
      groups.push({ type: "tool", tool: part });
    } else if (isReasoningPart(part)) {
      flushText();
      groups.push({ type: "reasoning", text: part.text, isStreaming: part.state === "streaming" });
    }
    // Skip tool-result and other non-renderable parts
  }

  flushText();
  return groups;
}
