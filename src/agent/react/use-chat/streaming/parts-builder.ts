/**
 * Parts Builder
 *
 * Logic for building UI message parts from streaming state.
 */

import type { ToolUIPart, UIMessagePart } from "../types.ts";
import type { OrderedReasoning, OrderedToolCall, TextBlock } from "./types.ts";

interface OrderedPart {
  order: number;
  part: UIMessagePart;
}

/**
 * Build current parts for onUpdate - preserves stream order
 */
export function buildCurrentParts(
  textBlocks: Map<string, TextBlock>,
  reasoningBlocks: Map<string, OrderedReasoning>,
  toolCalls: Map<string, OrderedToolCall>,
): UIMessagePart[] {
  const orderedParts: OrderedPart[] = [];

  addTextParts(orderedParts, textBlocks);
  addReasoningParts(orderedParts, reasoningBlocks);
  addToolParts(orderedParts, toolCalls);

  return orderedParts.sort((a, b) => a.order - b.order).map((p) => p.part);
}

function addTextParts(
  orderedParts: OrderedPart[],
  textBlocks: Map<string, TextBlock>,
): void {
  for (const [, block] of textBlocks) {
    if (block.text && block.order !== null) {
      orderedParts.push({
        order: block.order,
        part: { type: "text", text: block.text, state: block.state },
      });
    }
  }
}

function addReasoningParts(
  orderedParts: OrderedPart[],
  reasoningBlocks: Map<string, OrderedReasoning>,
): void {
  for (const [, reasoning] of reasoningBlocks) {
    orderedParts.push({
      order: reasoning.order,
      part: {
        type: "reasoning",
        text: reasoning.text,
        state: reasoning.isComplete ? "done" : "streaming",
      },
    });
  }
}

function addToolParts(
  orderedParts: OrderedPart[],
  toolCalls: Map<string, OrderedToolCall>,
): void {
  for (const [, tool] of toolCalls) {
    if (tool.dynamic) {
      orderedParts.push({
        order: tool.order,
        part: {
          type: "dynamic-tool",
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          input: tool.input,
          output: tool.output,
          errorText: tool.error,
        },
      });
    } else {
      orderedParts.push({
        order: tool.order,
        part: {
          type: `tool-${tool.toolName}` as const,
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          state: tool.state,
          input: tool.input,
          output: tool.output,
          errorText: tool.error,
        } as ToolUIPart,
      });
    }
  }
}
