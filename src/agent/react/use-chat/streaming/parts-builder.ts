import type { ToolUIPart, UIMessagePart } from "../types.ts";
import type { OrderedReasoning, OrderedToolCall, TextBlock } from "./types.ts";

interface OrderedPart {
  order: number;
  part: UIMessagePart;
}

export function buildCurrentParts(
  textBlocks: Map<string, TextBlock>,
  reasoningBlocks: Map<string, OrderedReasoning>,
  toolCalls: Map<string, OrderedToolCall>,
): UIMessagePart[] {
  const orderedParts: OrderedPart[] = [];

  addTextParts(orderedParts, textBlocks);
  addReasoningParts(orderedParts, reasoningBlocks);
  addToolParts(orderedParts, toolCalls);

  orderedParts.sort((a, b) => a.order - b.order);
  return orderedParts.map(({ part }) => part);
}

function addTextParts(
  orderedParts: OrderedPart[],
  textBlocks: Map<string, TextBlock>,
): void {
  for (const { text, order, state } of textBlocks.values()) {
    if (!text || order === null) continue;

    orderedParts.push({
      order,
      part: { type: "text", text, state },
    });
  }
}

function addReasoningParts(
  orderedParts: OrderedPart[],
  reasoningBlocks: Map<string, OrderedReasoning>,
): void {
  for (const { order, text, isComplete } of reasoningBlocks.values()) {
    orderedParts.push({
      order,
      part: {
        type: "reasoning",
        text,
        state: isComplete ? "done" : "streaming",
      },
    });
  }
}

function addToolParts(
  orderedParts: OrderedPart[],
  toolCalls: Map<string, OrderedToolCall>,
): void {
  for (const tool of toolCalls.values()) {
    const base = {
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      state: tool.state,
      input: tool.input,
      output: tool.output,
      errorText: tool.error,
    };

    const part: UIMessagePart = tool.dynamic
      ? { type: "dynamic-tool", ...base }
      : ({ type: `tool-${tool.toolName}`, ...base } as ToolUIPart);

    orderedParts.push({ order: tool.order, part });
  }
}
