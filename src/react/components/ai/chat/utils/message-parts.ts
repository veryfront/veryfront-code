/**
 * Message Parts Utilities
 * @module ai/react/components/chat/utils/message-parts
 */

import type {
  DynamicToolUIPart,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
} from "#veryfront/agent/react";
import type { Source } from "../components/sources.tsx";

/** Get text content from UIMessage parts */
export function getTextContent(message: UIMessage): string {
  let text = "";

  for (const part of message.parts) {
    if (part.type === "text") text += part.text;
  }

  return text;
}

/** Check if a part is a tool part */
export function isToolPart(part: UIMessagePart): part is ToolUIPart | DynamicToolUIPart {
  if (part.type === "dynamic-tool") return true;
  return part.type.startsWith("tool-") && part.type !== "tool-result";
}

/** Check if a part is a reasoning part */
export function isReasoningPart(
  part: UIMessagePart,
): part is { type: "reasoning"; text: string; state?: "streaming" | "done" } {
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
  let textBuffer = "";

  function flushText(): void {
    if (!textBuffer) return;
    groups.push({ type: "text", content: textBuffer });
    textBuffer = "";
  }

  for (const part of parts) {
    if (part.type === "text") {
      textBuffer += part.text;
      continue;
    }

    // Skip tool-result parts without flushing text buffer
    if (part.type === "tool-result") {
      continue;
    }

    flushText();

    if (isToolPart(part)) {
      groups.push({ type: "tool", tool: part });
      continue;
    }

    if (isReasoningPart(part)) {
      groups.push({
        type: "reasoning",
        text: part.text,
        isStreaming: part.state === "streaming",
      });
    }
    // Skip other non-renderable parts
  }

  flushText();
  return groups;
}

/**
 * Extract sources from tool result parts.
 * Looks for `documents` arrays in tool outputs and maps them to Source[].
 */
export function extractSourcesFromParts(parts: UIMessagePart[]): Source[] {
  const sources: Source[] = [];

  for (const part of parts) {
    if (part.type !== "tool-result") continue;

    const result = (part as { result?: unknown }).result;
    if (!result || typeof result !== "object") continue;

    const docs = (result as Record<string, unknown>).documents;
    if (!Array.isArray(docs)) continue;

    for (const doc of docs) {
      if (!doc || typeof doc !== "object") continue;
      const d = doc as Record<string, unknown>;
      sources.push({
        title: typeof d.title === "string" ? d.title : typeof d.name === "string" ? d.name : "Source",
        url: typeof d.url === "string" ? d.url : undefined,
        score: typeof d.score === "number" ? d.score : undefined,
        snippet: typeof d.snippet === "string"
          ? d.snippet
          : typeof d.content === "string"
          ? d.content.slice(0, 200)
          : undefined,
      });
    }
  }

  return sources;
}
