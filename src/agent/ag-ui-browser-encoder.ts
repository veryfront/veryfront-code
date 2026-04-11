import type { AgentResponse } from "./types.ts";

export type AgUiRuntimeStreamEvent = Record<string, unknown> & { type: string };

export interface AgUiBrowserRunFinishedMetadata {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
}

export interface AgUiBrowserEncoderState {
  messageId: string | null;
  textOpen: boolean;
  reasoningMessageId: string | null;
  activeStepName: string | null;
  stepCount: number;
  streamedToolInputIds: Set<string>;
  sawVisibleOutput: boolean;
  sawTerminalError: boolean;
  metadata: AgUiBrowserRunFinishedMetadata;
}

export interface AgUiBrowserEncodedEvent {
  event: string;
  payload: Record<string, unknown>;
}

export function createAgUiBrowserEncoderState(): AgUiBrowserEncoderState {
  return {
    messageId: null,
    textOpen: false,
    reasoningMessageId: null,
    activeStepName: null,
    stepCount: 0,
    streamedToolInputIds: new Set<string>(),
    sawVisibleOutput: false,
    sawTerminalError: false,
    metadata: {},
  };
}

function serializeToolInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

function getMessageId(state: AgUiBrowserEncoderState, event: AgUiRuntimeStreamEvent): string {
  if (typeof event.messageId === "string") {
    state.messageId = event.messageId;
    return event.messageId;
  }

  if (!state.messageId && typeof event.id === "string") {
    state.messageId = event.id;
  }

  if (!state.messageId) {
    state.messageId = crypto.randomUUID();
  }

  return state.messageId;
}

function getReasoningMessageId(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): string {
  if (typeof event.id === "string" && event.id.length > 0) {
    state.reasoningMessageId = state.messageId
      ? `${state.messageId}:reasoning:${event.id}`
      : event.id;
    return state.reasoningMessageId;
  }

  if (!state.reasoningMessageId) {
    state.reasoningMessageId = state.messageId
      ? `${state.messageId}:reasoning:${crypto.randomUUID()}`
      : crypto.randomUUID();
  }

  return state.reasoningMessageId;
}

function nextStepName(state: AgUiBrowserEncoderState): string {
  state.stepCount += 1;
  state.activeStepName = `step-${state.stepCount}`;
  return state.activeStepName;
}

function finishStepName(state: AgUiBrowserEncoderState): string {
  const stepName = state.activeStepName ?? `step-${Math.max(state.stepCount, 1)}`;
  state.activeStepName = null;
  return stepName;
}

function applyDataMetadata(state: AgUiBrowserEncoderState, event: AgUiRuntimeStreamEvent): void {
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : event;

  if (typeof data.model === "string") {
    state.metadata.model = data.model;
    const provider = data.model.split("/")[0];
    if (provider) {
      state.metadata.provider = provider;
    }
  }
}

function applyResponseMetadata(
  state: AgUiBrowserEncoderState,
  response: AgentResponse | null,
): void {
  if (!response) return;

  if (response.usage) {
    state.metadata.inputTokens = response.usage.promptTokens;
    state.metadata.outputTokens = response.usage.completionTokens;
    state.metadata.totalTokens = response.usage.totalTokens;
  }

  const finishReason = response.metadata && typeof response.metadata === "object"
    ? response.metadata.finishReason
    : undefined;
  if (typeof finishReason === "string") {
    state.metadata.finishReason = finishReason;
  }
}

function completeToolInput(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiBrowserEncodedEvent[] {
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
  const events: AgUiBrowserEncodedEvent[] = [];

  if (toolCallId.length > 0 && !state.streamedToolInputIds.has(toolCallId)) {
    events.push({
      event: "ToolCallArgs",
      payload: {
        toolCallId,
        delta: serializeToolInput("input" in event ? event.input : {}),
      },
    });
  }

  if (toolCallId.length > 0) {
    state.streamedToolInputIds.delete(toolCallId);
  }

  events.push({
    event: "ToolCallEnd",
    payload: { toolCallId: event.toolCallId },
  });

  return events;
}

export function mapRuntimeStreamEventToAgUiBrowserEvents(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): AgUiBrowserEncodedEvent[] {
  if (event.type.startsWith("data-")) {
    const name = event.type.slice("data-".length);
    if (name.length === 0) {
      return [];
    }

    state.sawVisibleOutput = true;
    return [{
      event: "Custom",
      payload: {
        name,
        value: "data" in event ? event.data : null,
      },
    }];
  }

  switch (event.type) {
    case "message-start":
      getMessageId(state, event);
      return [];

    case "text-start": {
      if (state.textOpen) return [];
      const messageId = getMessageId(state, event);
      state.textOpen = true;
      state.sawVisibleOutput = true;
      return [{
        event: "TextMessageStart",
        payload: { messageId, role: "assistant" },
      }];
    }

    case "text-delta": {
      const messageId = getMessageId(state, event);
      state.sawVisibleOutput = true;
      if (!state.textOpen) {
        state.textOpen = true;
        return [
          { event: "TextMessageStart", payload: { messageId, role: "assistant" } },
          {
            event: "TextMessageContent",
            payload: { messageId, delta: typeof event.delta === "string" ? event.delta : "" },
          },
        ];
      }

      return [{
        event: "TextMessageContent",
        payload: { messageId, delta: typeof event.delta === "string" ? event.delta : "" },
      }];
    }

    case "text-end": {
      if (!state.textOpen) return [];
      state.textOpen = false;
      return [{
        event: "TextMessageEnd",
        payload: { messageId: getMessageId(state, event) },
      }];
    }

    case "reasoning-start":
      state.sawVisibleOutput = true;
      return [{
        event: "ReasoningMessageStart",
        payload: { messageId: getReasoningMessageId(state, event), role: "reasoning" },
      }];

    case "reasoning-delta":
      state.sawVisibleOutput = true;
      return [{
        event: "ReasoningMessageContent",
        payload: {
          messageId: getReasoningMessageId(state, event),
          delta: typeof event.delta === "string" ? event.delta : "",
        },
      }];

    case "reasoning-end": {
      const messageId = getReasoningMessageId(state, event);
      state.reasoningMessageId = null;
      return [{
        event: "ReasoningMessageEnd",
        payload: { messageId },
      }];
    }

    case "tool-input-start":
      state.sawVisibleOutput = true;
      return [{
        event: "ToolCallStart",
        payload: {
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
        },
      }];

    case "tool-input-delta":
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string") {
        state.streamedToolInputIds.add(event.toolCallId);
      }
      return [{
        event: "ToolCallArgs",
        payload: {
          toolCallId: event.toolCallId,
          delta: typeof event.inputTextDelta === "string" ? event.inputTextDelta : "",
        },
      }];

    case "tool-input-available": {
      state.sawVisibleOutput = true;
      return completeToolInput(state, event);
    }

    case "tool-input-error": {
      state.sawVisibleOutput = true;
      const events = completeToolInput(state, event);
      events.push({
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: {
            error: typeof event.errorText === "string" ? event.errorText : "Tool input failed",
          },
          isError: true,
        },
      });
      return events;
    }

    case "tool-output-available":
      state.sawVisibleOutput = true;
      return [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: event.output,
        },
      }];

    case "tool-output-error":
      state.sawVisibleOutput = true;
      return [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: { error: event.errorText },
          isError: true,
        },
      }];

    case "tool-output-denied":
      state.sawVisibleOutput = true;
      return [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: { error: "Tool output denied" },
          isError: true,
        },
      }];

    case "step-start":
    case "start-step":
      state.sawVisibleOutput = true;
      return [{
        event: "StepStarted",
        payload: { stepName: nextStepName(state) },
      }];

    case "step-end":
    case "finish-step":
      state.sawVisibleOutput = true;
      return [{
        event: "StepFinished",
        payload: { stepName: finishStepName(state) },
      }];

    case "data":
      applyDataMetadata(state, event);
      return [];

    case "error":
      state.sawTerminalError = true;
      return [{
        event: "RunError",
        payload: {
          message: typeof event.error === "string" ? event.error : "Agent run failed",
        },
      }];

    default:
      return [];
  }
}

export function finalizeAgUiBrowserEvents(
  state: AgUiBrowserEncoderState,
  response: AgentResponse | null,
): AgUiBrowserEncodedEvent[] {
  applyResponseMetadata(state, response);

  if (state.sawTerminalError) {
    return [];
  }

  if (!state.sawVisibleOutput) {
    state.sawTerminalError = true;
    return [{
      event: "RunError",
      payload: {
        code: "EMPTY_ASSISTANT_OUTPUT",
        message: "Agent run produced no assistant-visible output",
      },
    }];
  }

  const events: AgUiBrowserEncodedEvent[] = [];
  if (state.textOpen) {
    state.textOpen = false;
    events.push({
      event: "TextMessageEnd",
      payload: { messageId: getMessageId(state, { type: "text-end" }) },
    });
  }

  events.push({
    event: "RunFinished",
    payload: {
      metadata: state.metadata,
    },
  });

  return events;
}
