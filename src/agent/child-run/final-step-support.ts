interface ToolCallLike {
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

interface ToolResultLike {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
}

/** Append missing child run tool calls. */
export function appendMissingChildRunToolCalls(
  toolCalls: ToolCallLike[],
  fallbackToolCalls: ToolCallLike[],
): void {
  const existingToolCallIds = new Set(toolCalls.map((toolCall) => toolCall.toolCallId));
  for (const toolCall of fallbackToolCalls) {
    if (existingToolCallIds.has(toolCall.toolCallId)) {
      continue;
    }

    toolCalls.push(toolCall);
    existingToolCallIds.add(toolCall.toolCallId);
  }
}

/** Append missing child run tool results. */
export function appendMissingChildRunToolResults(
  toolResults: ToolResultLike[],
  fallbackToolResults: ToolResultLike[],
): void {
  const existingToolResultIds = new Set(toolResults.map((toolResult) => toolResult.toolCallId));
  for (const toolResult of fallbackToolResults) {
    if (existingToolResultIds.has(toolResult.toolCallId)) {
      continue;
    }

    toolResults.push(toolResult);
    existingToolResultIds.add(toolResult.toolCallId);
  }
}

/** Message shape for build child run exhausted step budget error. */
export function buildChildRunExhaustedStepBudgetErrorMessage(
  stepCount: number,
  toolCalls: Array<{ toolName: string }>,
): string {
  const calledToolNames = [...new Set(toolCalls.map((toolCall) => toolCall.toolName))];
  const toolList = calledToolNames.join(", ") || "(none)";
  return `Child agent exhausted its step budget (${stepCount} steps) without completing the task. Tools called: ${toolList}. Increase max_steps or simplify the task.`;
}
