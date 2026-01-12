/**
 * Streaming Parts Builder
 *
 * Utilities for building message parts during streaming.
 *
 * @module ai/react/hooks/use-chat/streaming/parts
 */

import type { ToolUIPart, UIMessagePart } from "../types.ts";
import type { StreamingReasoning, StreamingTextBlock, StreamingToolCall } from "./types.ts";

/**
 * Build current parts for onUpdate - preserves stream order.
 *
 * Collects all parts (text, reasoning, tools) with their order
 * and returns them sorted by arrival order.
 */
export function buildCurrentParts(
  textBlocks: Map<string, StreamingTextBlock>,
  reasoningBlocks: Map<string, StreamingReasoning>,
  toolCalls: Map<string, StreamingToolCall>,
): UIMessagePart[] {
  const orderedParts: Array<{ order: number; part: UIMessagePart }> = [];

  // Add text parts (only if they have content and an order)
  for (const [, block] of textBlocks) {
    if (block.text && block.order !== null) {
      orderedParts.push({
        order: block.order,
        part: { type: "text", text: block.text, state: block.state },
      });
    }
  }

  // Add reasoning parts
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

  // Add tool parts - use "dynamic-tool" type for dynamic tools
  for (const [, tool] of toolCalls) {
    if (tool.dynamic) {
      // Dynamic tools use "dynamic-tool" part type (AI SDK v5)
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
      // Static tools use "tool-${toolName}" part type (AI SDK v5)
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

  // Sort by order and extract parts
  return orderedParts.sort((a, b) => a.order - b.order).map((p) => p.part);
}
