import { estimateTokens } from "./message-prep-budget.ts";
import type { MessageTokenBreakdown } from "./message-prep-types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEmptyTokenBreakdown(totalTokens: number): MessageTokenBreakdown {
  return {
    totalTokens,
    systemTextTokens: 0,
    userContentTokens: 0,
    assistantContentTokens: 0,
    reasoningTokens: 0,
    toolCallInputTokens: 0,
    toolResultOutputTokens: 0,
    fileTokens: 0,
    unknownTokens: 0,
  };
}

function addTextTokenBreakdown(
  breakdown: MessageTokenBreakdown,
  role: string,
  tokens: number,
): void {
  if (role === "system") breakdown.systemTextTokens += tokens;
  else if (role === "user") breakdown.userContentTokens += tokens;
  else if (role === "assistant") breakdown.assistantContentTokens += tokens;
  else breakdown.unknownTokens += tokens;
}

function readToolPartTokenValue(
  part: Record<string, unknown>,
  primary: string,
  fallback: string,
): unknown {
  if (primary in part) return part[primary];
  if (fallback in part) return part[fallback];
  return part;
}

function addPartTokenBreakdown(
  breakdown: MessageTokenBreakdown,
  role: string,
  part: unknown,
): void {
  if (!isRecord(part) || typeof part.type !== "string") {
    breakdown.unknownTokens += estimateTokens(part);
    return;
  }

  switch (part.type) {
    case "text": {
      const tokens = estimateTokens(typeof part.text === "string" ? part.text : part);
      addTextTokenBreakdown(breakdown, role, tokens);
      return;
    }
    case "reasoning":
      breakdown.reasoningTokens += estimateTokens(part);
      return;
    case "tool-call":
    case "tool_call":
    case "dynamic-tool":
      breakdown.toolCallInputTokens += estimateTokens(
        readToolPartTokenValue(part, "input", "args"),
      );
      return;
    case "tool-result":
    case "tool_result":
      breakdown.toolResultOutputTokens += estimateTokens(
        readToolPartTokenValue(part, "output", "result"),
      );
      return;
    case "file":
    case "image":
      breakdown.fileTokens += estimateTokens(part);
      return;
    default:
      if (part.type.startsWith("tool-")) {
        breakdown.toolCallInputTokens += estimateTokens(
          readToolPartTokenValue(part, "input", "args"),
        );
        return;
      }
      breakdown.unknownTokens += estimateTokens(part);
  }
}

function addContentTokenBreakdown(
  breakdown: MessageTokenBreakdown,
  role: string,
  content: unknown,
): void {
  if (typeof content === "string") {
    const tokens = estimateTokens(content);
    addTextTokenBreakdown(breakdown, role, tokens);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      addPartTokenBreakdown(breakdown, role, part);
    }
  } else {
    breakdown.unknownTokens += estimateTokens(content);
  }
}

/** Estimate token categories for provider, UI, or runtime messages. */
export function estimateMessageTokenBreakdown(messages: readonly unknown[]): MessageTokenBreakdown {
  const breakdown = createEmptyTokenBreakdown(estimateTokens(messages));

  for (const message of messages) {
    if (!isRecord(message)) {
      breakdown.unknownTokens += estimateTokens(message);
      continue;
    }

    const role = typeof message.role === "string" ? message.role : "unknown";
    if ("parts" in message && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        addPartTokenBreakdown(breakdown, role, part);
      }
      continue;
    }

    if ("content" in message) {
      const content = message.content;
      addContentTokenBreakdown(breakdown, role, content);
      continue;
    }

    breakdown.unknownTokens += estimateTokens(message);
  }

  return breakdown;
}
