import type { AgentResponse } from "#veryfront/agent";

const encoder = new TextEncoder();

type RuntimeDataEvent = Record<string, unknown> & { type: string };

export interface RunFinishedMetadata {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
}

export interface StreamTransformState {
  messageId: string | null;
  textOpen: boolean;
  stepIndex: number;
  sawTerminalError: boolean;
  metadata: RunFinishedMetadata;
}

export function createStreamTransformState(): StreamTransformState {
  return {
    messageId: null,
    textOpen: false,
    stepIndex: 0,
    sawTerminalError: false,
    metadata: {},
  };
}

export function formatAgUiEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function parseSseJsonEvents(chunk: string): {
  events: RuntimeDataEvent[];
  remainder: string;
} {
  const blocks = chunk.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    const payload = JSON.parse(dataLines.join("\n")) as RuntimeDataEvent;
    return [payload];
  });

  return { events, remainder };
}

function getMessageId(state: StreamTransformState, event: RuntimeDataEvent): string {
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

function applyDataMetadata(state: StreamTransformState, event: RuntimeDataEvent): void {
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

function applyResponseMetadata(state: StreamTransformState, response: AgentResponse | null): void {
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

export function mapRuntimeEventToAgUi(
  state: StreamTransformState,
  event: RuntimeDataEvent,
): Array<{ event: string; payload: Record<string, unknown> }> {
  switch (event.type) {
    case "message-start":
      getMessageId(state, event);
      return [];

    case "text-start": {
      if (state.textOpen) return [];
      const messageId = getMessageId(state, event);
      state.textOpen = true;
      return [{
        event: "TextMessageStart",
        payload: { messageId, role: "assistant" },
      }];
    }

    case "text-delta": {
      const messageId = getMessageId(state, event);
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

    case "tool-input-start":
      return [{
        event: "ToolCallStart",
        payload: {
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
        },
      }];

    case "tool-input-delta":
      return [{
        event: "ToolCallArgs",
        payload: {
          toolCallId: event.toolCallId,
          delta: typeof event.inputTextDelta === "string" ? event.inputTextDelta : "",
        },
      }];

    case "tool-input-available":
      return [{
        event: "ToolCallEnd",
        payload: { toolCallId: event.toolCallId },
      }];

    case "tool-output-available":
      return [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: event.output,
        },
      }];

    case "tool-output-error":
      return [{
        event: "ToolCallResult",
        payload: {
          toolCallId: event.toolCallId,
          result: { error: event.errorText },
          isError: true,
        },
      }];

    case "step-start":
      state.stepIndex += 1;
      return [{
        event: "StepStarted",
        payload: { stepIndex: state.stepIndex },
      }];

    case "step-end":
      return [{
        event: "StepFinished",
        payload: { stepIndex: state.stepIndex },
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

export function finalizeRunEvents(
  state: StreamTransformState,
  response: AgentResponse | null,
): Array<{ event: string; payload: Record<string, unknown> }> {
  applyResponseMetadata(state, response);

  if (state.sawTerminalError) {
    return [];
  }

  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
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
