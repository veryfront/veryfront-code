/**
 * Conversation Export Utilities
 * @module ai/react/components/chat/utils/export
 */

import type { UIMessage } from "#veryfront/agent/react";
import { extractSourcesFromParts, getTextContent } from "./message-parts.ts";

/**
 * Convert chat messages to a markdown string.
 */
export function exportAsMarkdown(messages: UIMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      lines.push(`**User:**\n${getTextContent(msg)}`);
      lines.push("");
      continue;
    }

    // Assistant message
    const textParts: string[] = [];
    const toolSummaries: string[] = [];

    for (const part of msg.parts) {
      if (part.type === "text") {
        textParts.push(part.text);
      } else if (part.type === "reasoning") {
        textParts.push(`> *Thinking:* ${part.text}`);
      } else if (part.type.startsWith("tool-") && part.type !== "tool-result" && "toolName" in part) {
        const name = (part as { toolName: string }).toolName;
        const state = (part as { state?: string }).state ?? "";
        toolSummaries.push(`> Tool: **${name}** (${state})`);
      }
    }

    lines.push("**Assistant:**");
    if (toolSummaries.length > 0) {
      lines.push(toolSummaries.join("\n"));
    }
    lines.push(textParts.join(""));

    const sources = extractSourcesFromParts(msg.parts);
    if (sources.length > 0) {
      lines.push(
        "\nSources: " +
          sources.map((s, i) => `[${i + 1}] ${s.title}${s.url ? ` (${s.url})` : ""}`).join(", "),
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Download messages as a .md file.
 */
export function downloadMarkdown(messages: UIMessage[], filename?: string): void {
  const md = exportAsMarkdown(messages);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `chat-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
