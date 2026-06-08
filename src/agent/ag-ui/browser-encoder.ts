import type { AgentResponse } from "../types.ts";

/** Event emitted for AG-UI runtime stream. */
export type AgUiRuntimeStreamEvent = Record<string, unknown> & { type: string };

/** Public API contract for AG-UI browser run finished metadata. */
export interface AgUiBrowserRunFinishedMetadata {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
}

/** State for AG-UI browser encoder. */
export interface AgUiBrowserEncoderState {
  messageId: string | null;
  textOpen: boolean;
  activeTextContentId: string | null;
  textContentIndex: number;
  reasoningMessageId: string | null;
  activeStepName: string | null;
  stepCount: number;
  streamedToolInputIds: Set<string>;
  sawVisibleOutput: boolean;
  sawTerminalError: boolean;
  metadata: AgUiBrowserRunFinishedMetadata;
}

/** Event emitted for AG-UI browser encoded. */
export interface AgUiBrowserEncodedEvent {
  event: string;
  payload: Record<string, unknown>;
}

/** State for create AG-UI browser encoder. */
export function createAgUiBrowserEncoderState(): AgUiBrowserEncoderState {
  return {
    messageId: null,
    textOpen: false,
    activeTextContentId: null,
    textContentIndex: 0,
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

function getTextMessageIdentity(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): { messageId: string; contentId: string } {
  const previousMessageId = state.messageId;
  const explicitMessageId = typeof event.messageId === "string" && event.messageId.length > 0
    ? event.messageId
    : null;
  const messageId = getMessageId(state, event);
  const explicitContentId = typeof event.contentId === "string" && event.contentId.length > 0
    ? event.contentId
    : null;
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;
  const contentId = explicitContentId ??
    (eventId && eventId !== messageId && (explicitMessageId || previousMessageId)
      ? eventId
      : null) ??
    (state.textOpen && state.activeTextContentId ? state.activeTextContentId : null) ??
    `text:${state.textContentIndex++}`;

  return {
    messageId,
    contentId,
  };
}

function getCandidateTextMessageIdentity(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): { messageId: string | null; contentId: string | null } {
  const explicitMessageId = typeof event.messageId === "string" && event.messageId.length > 0
    ? event.messageId
    : null;
  const messageId = explicitMessageId ?? state.messageId ??
    (typeof event.id === "string" && event.id.length > 0 ? event.id : null);
  const explicitContentId = typeof event.contentId === "string" && event.contentId.length > 0
    ? event.contentId
    : null;
  const eventId = typeof event.id === "string" && event.id.length > 0 ? event.id : null;
  const contentId = explicitContentId ??
    (eventId && messageId && eventId !== messageId && (explicitMessageId || state.messageId)
      ? eventId
      : null) ??
    state.activeTextContentId;

  return { messageId, contentId };
}

function isActiveTextIdentity(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
): boolean {
  const identity = getCandidateTextMessageIdentity(state, event);
  return identity.messageId === state.messageId && identity.contentId === state.activeTextContentId;
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

/** Response payload for build AG-UI browser finalize. */
export function buildAgUiBrowserFinalizeResponse(
  metadata: AgUiBrowserRunFinishedMetadata,
): AgentResponse | null {
  const responseMetadata: Record<string, unknown> = {};
  if (typeof metadata.finishReason === "string" && metadata.finishReason.length > 0) {
    responseMetadata.finishReason = metadata.finishReason;
  }

  const usage = typeof metadata.inputTokens === "number" ||
      typeof metadata.outputTokens === "number" ||
      typeof metadata.totalTokens === "number"
    ? {
      promptTokens: metadata.inputTokens ?? 0,
      completionTokens: metadata.outputTokens ?? 0,
      totalTokens: metadata.totalTokens ??
        ((metadata.inputTokens ?? 0) + (metadata.outputTokens ?? 0)),
    }
    : undefined;

  if (!usage && Object.keys(responseMetadata).length === 0) {
    return null;
  }

  return {
    text: "",
    messages: [],
    toolCalls: [],
    status: "completed",
    ...(usage ? { usage } : {}),
    ...(Object.keys(responseMetadata).length > 0 ? { metadata: responseMetadata } : {}),
  };
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

function createToolResultEvent(
  toolCallId: unknown,
  result: Record<string, unknown> | unknown,
  isError = false,
): AgUiBrowserEncodedEvent {
  return {
    event: "ToolCallResult",
    payload: {
      toolCallId,
      result,
      ...(isError ? { isError: true } : {}),
    },
  };
}

function createCustomDataEvent(
  name: string,
  value: unknown,
): AgUiBrowserEncodedEvent {
  return {
    event: "Custom",
    payload: { name, value },
  };
}

function createStepEvent(
  state: AgUiBrowserEncoderState,
  type: "StepStarted" | "StepFinished",
): AgUiBrowserEncodedEvent {
  return {
    event: type,
    payload: {
      stepName: type === "StepStarted" ? nextStepName(state) : finishStepName(state),
    },
  };
}

function createReasoningEvent(
  state: AgUiBrowserEncoderState,
  event: AgUiRuntimeStreamEvent,
  type: "ReasoningMessageStart" | "ReasoningMessageContent" | "ReasoningMessageEnd",
): AgUiBrowserEncodedEvent {
  const messageId = getReasoningMessageId(state, event);
  return {
    event: type,
    payload: type === "ReasoningMessageStart"
      ? { messageId, role: "reasoning" }
      : type === "ReasoningMessageContent"
      ? {
        messageId,
        delta: typeof event.delta === "string" ? event.delta : "",
      }
      : { messageId },
  };
}

function createTextEvent(
  messageId: string,
  type: "TextMessageStart" | "TextMessageContent" | "TextMessageEnd",
  delta = "",
  contentId: string,
): AgUiBrowserEncodedEvent {
  return {
    event: type,
    payload: type === "TextMessageStart"
      ? { messageId, contentId, role: "assistant" }
      : type === "TextMessageContent"
      ? { messageId, contentId, delta }
      : { messageId, contentId },
  };
}

function closeOpenTextEvent(state: AgUiBrowserEncoderState): AgUiBrowserEncodedEvent[] {
  if (!state.textOpen) {
    return [];
  }

  state.textOpen = false;
  const event = createTextEvent(
    getMessageId(state, { type: "text-end" }),
    "TextMessageEnd",
    "",
    state.activeTextContentId ?? `text:${state.textContentIndex++}`,
  );
  state.activeTextContentId = null;
  return [event];
}

function closeOpenReasoningEvent(state: AgUiBrowserEncoderState): AgUiBrowserEncodedEvent[] {
  if (state.reasoningMessageId === null) {
    return [];
  }

  const messageId = state.reasoningMessageId;
  state.reasoningMessageId = null;
  return [{
    event: "ReasoningMessageEnd",
    payload: { messageId },
  }];
}

/** Map runtime stream event to AG-UI browser events. */
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
    return [createCustomDataEvent(name, "data" in event ? event.data : null)];
  }

  switch (event.type) {
    case "message-start":
      getMessageId(state, event);
      return [];

    case "text-start": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen) {
        if (isActiveTextIdentity(state, event)) return events;
        events.push(...closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.textOpen = true;
      state.activeTextContentId = contentId;
      state.sawVisibleOutput = true;
      events.push(createTextEvent(messageId, "TextMessageStart", "", contentId));
      return events;
    }

    case "text-delta": {
      const events = closeOpenReasoningEvent(state);
      if (state.textOpen && !isActiveTextIdentity(state, event)) {
        events.push(...closeOpenTextEvent(state));
      }
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.sawVisibleOutput = true;
      if (!state.textOpen) {
        state.textOpen = true;
        state.activeTextContentId = contentId;
        events.push(
          createTextEvent(messageId, "TextMessageStart", "", contentId),
          createTextEvent(
            messageId,
            "TextMessageContent",
            typeof event.delta === "string" ? event.delta : "",
            contentId,
          ),
        );
        return events;
      }

      events.push(createTextEvent(
        messageId,
        "TextMessageContent",
        typeof event.delta === "string" ? event.delta : "",
        state.activeTextContentId ?? contentId,
      ));
      return events;
    }

    case "text-end": {
      if (!state.textOpen) return [];
      const { messageId, contentId } = getTextMessageIdentity(state, event);
      state.textOpen = false;
      const resolvedContentId = state.activeTextContentId ?? contentId;
      state.activeTextContentId = null;
      return [createTextEvent(messageId, "TextMessageEnd", "", resolvedContentId)];
    }

    case "reasoning-start": {
      const events = closeOpenTextEvent(state);
      events.push(...closeOpenReasoningEvent(state));
      state.sawVisibleOutput = true;
      events.push(createReasoningEvent(state, event, "ReasoningMessageStart"));
      return events;
    }

    case "reasoning-delta": {
      const events = closeOpenTextEvent(state);
      state.sawVisibleOutput = true;
      if (state.reasoningMessageId === null) {
        events.push(createReasoningEvent(state, event, "ReasoningMessageStart"));
      }
      events.push(createReasoningEvent(state, event, "ReasoningMessageContent"));
      return events;
    }

    case "reasoning-end": {
      const reasoningEvent = createReasoningEvent(state, event, "ReasoningMessageEnd");
      state.reasoningMessageId = null;
      return [reasoningEvent];
    }

    case "tool-input-start": {
      const events = [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
      ];
      state.sawVisibleOutput = true;
      events.push({
        event: "ToolCallStart",
        payload: {
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
        },
      });
      return events;
    }

    case "tool-input-delta":
      state.sawVisibleOutput = true;
      if (typeof event.toolCallId === "string") {
        state.streamedToolInputIds.add(event.toolCallId);
      }
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        {
          event: "ToolCallArgs",
          payload: {
            toolCallId: event.toolCallId,
            delta: typeof event.inputTextDelta === "string" ? event.inputTextDelta : "",
          },
        },
      ];

    case "tool-input-available": {
      state.sawVisibleOutput = true;
      const events = [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        ...completeToolInput(state, event),
      ];
      if (event.providerExecuted === true) {
        events.push(createToolResultEvent(event.toolCallId, null));
      }
      return events;
    }

    case "tool-input-error": {
      state.sawVisibleOutput = true;
      const events = [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        ...completeToolInput(state, event),
      ];
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
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createToolResultEvent(event.toolCallId, event.output),
      ];

    case "tool-output-error":
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createToolResultEvent(event.toolCallId, { error: event.errorText }, true),
      ];

    case "tool-output-denied":
      state.sawVisibleOutput = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createToolResultEvent(event.toolCallId, { error: "Tool output denied" }, true),
      ];

    case "step-start":
    case "start-step":
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createStepEvent(state, "StepStarted"),
      ];

    case "step-end":
    case "finish-step":
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        createStepEvent(state, "StepFinished"),
      ];

    case "data":
      applyDataMetadata(state, event);
      return [];

    case "error":
      state.sawTerminalError = true;
      return [
        ...closeOpenTextEvent(state),
        ...closeOpenReasoningEvent(state),
        {
          event: "RunError",
          payload: {
            message: typeof event.error === "string" ? event.error : "Agent run failed",
          },
        },
      ];

    default:
      if (typeof event.type === "string" && event.type.startsWith("data-")) {
        return [createCustomDataEvent(event.type.slice(5), event.data)];
      }
      return [];
  }
}

/** Finalize AG-UI browser events helper. */
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
  events.push(...closeOpenTextEvent(state));
  events.push(...closeOpenReasoningEvent(state));

  events.push({
    event: "RunFinished",
    payload: {
      metadata: state.metadata,
    },
  });

  return events;
}
