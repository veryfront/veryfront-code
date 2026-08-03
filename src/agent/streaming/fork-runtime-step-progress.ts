import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";
import type { ForkRuntimeStep } from "./fork-runtime-types.ts";

export interface ForkRuntimeProgress {
  steps: ForkRuntimeStep[];
  currentMessages: AgentMessage[];
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
}

/** Build a fork runtime step from an agent response. */
export function buildForkRuntimeStepFromResponse(response: AgentResponse): ForkRuntimeStep {
  const toolCalls = response.toolCalls.map((toolCall) => ({
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: toolCall.args,
  }));
  const toolResults = response.toolCalls.flatMap((toolCall) =>
    toolCall.status === "completed"
      ? [
        {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
          output: toolCall.result,
        },
      ]
      : []
  );
  const finishReasonValue = response.metadata?.finishReason;

  return {
    text: response.text,
    messages: structuredClone(response.messages),
    toolCalls,
    toolResults,
    finishReason: typeof finishReasonValue === "string" ? finishReasonValue : null,
  };
}

/** Should continue fork runtime step helper. */
export function shouldContinueForkRuntimeStep(
  step: ForkRuntimeStep,
  response: AgentResponse,
): boolean {
  return step.finishReason === "tool-calls" &&
    response.toolCalls.some((toolCall) => toolCall.status !== "error");
}

export function createForkRuntimeProgress(
  currentMessages: AgentMessage[],
): ForkRuntimeProgress {
  return {
    steps: [],
    currentMessages,
    accumulatedInputTokens: 0,
    accumulatedOutputTokens: 0,
  };
}

export function commitForkRuntimeStep(
  progress: ForkRuntimeProgress,
  response: AgentResponse,
): ForkRuntimeStep {
  const step = buildForkRuntimeStepFromResponse(response);
  progress.steps.push(step);
  progress.accumulatedInputTokens += response.usage?.promptTokens ?? 0;
  progress.accumulatedOutputTokens += response.usage?.completionTokens ?? 0;
  progress.currentMessages = response.messages;
  return step;
}

export function getForkRuntimeProgressUsage(
  progress: ForkRuntimeProgress,
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: progress.accumulatedInputTokens,
    outputTokens: progress.accumulatedOutputTokens,
  };
}
