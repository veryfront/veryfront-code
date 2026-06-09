import type { ClaudeCodeEvent, ClaudeCodeEventExtended, ClaudeCodeResult } from "../types.ts";

export interface ClaudeCodeCurrentTool {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeCodeToolCall extends ClaudeCodeCurrentTool {
  output?: string;
  isError?: boolean;
}

export interface ClaudeCodeAllToolCall extends ClaudeCodeToolCall {
  iteration: number;
}

export interface ClaudeCodeEventState {
  isRunning: boolean;
  currentIteration: number;
  maxIterations: number;
  text: string;
  currentTool: ClaudeCodeCurrentTool | null;
  toolCalls: ClaudeCodeToolCall[];
  result: ClaudeCodeResult | null;
  error: string | null;
}

export interface ClaudeCodeEventReducerOptions {
  keepEventHistory?: boolean;
  maxEventHistory?: number;
  trackAllToolCalls?: boolean;
}

type ClaudeCodeEventStateWithOptionalTracking = ClaudeCodeEventState & {
  events?: ClaudeCodeEvent[];
  allToolCalls?: ClaudeCodeAllToolCall[];
};

const CLAUDE_CODE_CORE_EVENT_TYPES = new Set<ClaudeCodeEvent["type"]>([
  "iteration_start",
  "text_delta",
  "text_complete",
  "tool_call_start",
  "tool_call_input",
  "tool_call_complete",
  "tool_result",
  "iteration_complete",
  "thinking_start",
  "thinking_delta",
  "thinking_complete",
  "complete",
  "error",
]);

export function createClaudeCodeEventState(): ClaudeCodeEventState {
  return {
    isRunning: false,
    currentIteration: 0,
    maxIterations: 20,
    text: "",
    currentTool: null,
    toolCalls: [],
    result: null,
    error: null,
  };
}

export function isClaudeCodeCoreEvent(
  event: ClaudeCodeEventExtended,
): event is ClaudeCodeEvent {
  return CLAUDE_CODE_CORE_EVENT_TYPES.has(event.type as ClaudeCodeEvent["type"]);
}

export function reduceClaudeCodeEventState<
  TState extends ClaudeCodeEventStateWithOptionalTracking,
>(
  previous: TState,
  event: ClaudeCodeEvent,
  options: ClaudeCodeEventReducerOptions = {},
): TState {
  const next = { ...previous };

  if (options.keepEventHistory && Array.isArray(next.events)) {
    next.events = [...(previous.events ?? []), event].slice(
      -(options.maxEventHistory ?? 100),
    );
  }

  switch (event.type) {
    case "iteration_start":
      next.isRunning = true;
      next.currentIteration = event.iteration;
      next.maxIterations = event.maxIterations;
      next.toolCalls = [];
      next.currentTool = null;
      break;

    case "text_delta":
      next.text = previous.text + event.content;
      break;

    case "text_complete":
      next.text = event.content;
      break;

    case "tool_call_start":
      next.currentTool = {
        id: event.toolCallId,
        name: event.toolName,
        input: {},
      };
      break;

    case "tool_call_complete":
      next.currentTool = null;
      next.toolCalls = [
        ...previous.toolCalls,
        {
          id: event.toolCallId,
          name: event.toolName,
          input: event.input,
        },
      ];
      break;

    case "tool_result": {
      next.toolCalls = previous.toolCalls.map((toolCall) =>
        toolCall.id === event.toolCallId
          ? { ...toolCall, output: event.output, isError: event.isError }
          : toolCall
      );

      if (options.trackAllToolCalls && Array.isArray(next.allToolCalls)) {
        const matchingToolCall = previous.toolCalls.find((toolCall) =>
          toolCall.id === event.toolCallId
        );
        next.allToolCalls = [
          ...(previous.allToolCalls ?? []),
          {
            iteration: event.iteration ?? previous.currentIteration,
            id: event.toolCallId,
            name: event.toolName,
            input: matchingToolCall?.input ?? {},
            output: event.output,
            isError: event.isError,
          },
        ];
      }
      break;
    }

    case "iteration_complete":
      next.currentTool = null;
      break;

    case "complete":
      next.isRunning = false;
      next.result = event.result;
      next.currentTool = null;
      break;

    case "error":
      next.error = event.message;
      if (!event.recoverable) {
        next.isRunning = false;
      }
      break;
  }

  return next;
}
