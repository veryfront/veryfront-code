import type { ChatMessagePart, ChatToolPart } from "../types.ts";
import type {
  OrderedMessagePart,
  OrderedReasoning,
  OrderedStep,
  OrderedToolCall,
  TextBlock,
} from "./types.ts";

interface OrderedPart {
  order: number;
  part: ChatMessagePart;
}

export function buildCurrentParts(
  textBlocks: Map<string, TextBlock>,
  reasoningBlocks: Map<string, OrderedReasoning>,
  toolCalls: Map<string, OrderedToolCall>,
  steps?: Map<number, OrderedStep>,
  extraParts?: OrderedMessagePart[],
  /**
   * Reasoning spans that closed and were then superseded by a later span
   * reusing the same wire id. They are no longer addressable by id but still
   * belong in the transcript at the position they streamed in.
   */
  closedReasoningBlocks?: readonly OrderedReasoning[],
  /**
   * Text blocks that closed and were then superseded by a later block reusing
   * the same content id. No longer addressable, still part of the answer.
   */
  closedTextBlocks?: readonly TextBlock[],
): ChatMessagePart[] {
  const orderedParts: OrderedPart[] = [];

  addTextParts(orderedParts, textBlocks.values());
  if (closedTextBlocks) addTextParts(orderedParts, closedTextBlocks);
  addReasoningParts(orderedParts, reasoningBlocks.values());
  if (closedReasoningBlocks) addReasoningParts(orderedParts, closedReasoningBlocks);
  addToolParts(orderedParts, toolCalls);
  if (steps) addStepParts(orderedParts, steps);
  if (extraParts) addExtraParts(orderedParts, extraParts);

  orderedParts.sort((a, b) => a.order - b.order);
  return orderedParts.map(({ part }) => part);
}

function addExtraParts(
  orderedParts: OrderedPart[],
  extraParts: OrderedMessagePart[],
): void {
  for (const { order, part } of extraParts) {
    orderedParts.push({ order, part });
  }
}

function addTextParts(
  orderedParts: OrderedPart[],
  textBlocks: Iterable<TextBlock>,
): void {
  for (const { text, order, state } of textBlocks) {
    if (!text || order === null) continue;

    orderedParts.push({
      order,
      part: { type: "text", text, state },
    });
  }
}

function addReasoningParts(
  orderedParts: OrderedPart[],
  reasoningBlocks: Iterable<OrderedReasoning>,
): void {
  for (const { order, text, signature, redactedData, isComplete } of reasoningBlocks) {
    orderedParts.push({
      order,
      part: {
        type: "reasoning",
        text,
        ...(typeof signature === "string" ? { signature } : {}),
        ...(typeof redactedData === "string" ? { redactedData } : {}),
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
      ...(tool.input !== undefined ? { input: tool.input } : {}),
      ...(tool.output !== undefined ? { output: tool.output } : {}),
      ...(tool.error !== undefined ? { errorText: tool.error } : {}),
      ...(tool.providerExecuted !== undefined ? { providerExecuted: tool.providerExecuted } : {}),
    };

    const part: ChatMessagePart = tool.dynamic
      ? { type: "dynamic-tool", ...base }
      : ({ type: `tool-${tool.toolName}`, ...base } as ChatToolPart);

    orderedParts.push({ order: tool.order, part });
  }
}

function addStepParts(
  orderedParts: OrderedPart[],
  steps: Map<number, OrderedStep>,
): void {
  for (const step of steps.values()) {
    orderedParts.push({
      order: step.order,
      part: {
        type: step.isComplete ? "step-end" : "step-start",
        stepIndex: step.index,
      },
    });
  }
}
