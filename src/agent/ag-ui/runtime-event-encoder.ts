import {
  type AgentResponse,
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserEncoderState,
  type AgUiBrowserRunFinishedMetadata,
  type AgUiRuntimeStreamEvent,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "../index.ts";

export interface AgUiRuntimeEventEncoder {
  state: AgUiBrowserEncoderState;
  encode: (event: AgUiRuntimeStreamEvent) => AgUiBrowserEncodedEvent[];
  finalize: (response: AgentResponse | null) => AgUiBrowserEncodedEvent[];
}

export interface CreateAgUiRuntimeEventEncoderOptions {
  initialMetadata?: Partial<AgUiBrowserRunFinishedMetadata>;
}

export function createAgUiRuntimeEventEncoder(
  options: CreateAgUiRuntimeEventEncoderOptions = {},
): AgUiRuntimeEventEncoder {
  const state = createAgUiBrowserEncoderState();
  const toolInputs = new Map<string, unknown>();

  Object.assign(state.metadata, options.initialMetadata ?? {});

  return {
    state,
    encode: (event) => {
      if (
        (event.type === "tool-input-available" || event.type === "tool-input-error") &&
        typeof event.toolCallId === "string"
      ) {
        toolInputs.set(event.toolCallId, event.input);
      }

      const encodedEvents = mapRuntimeStreamEventToAgUiBrowserEvents(state, event).map((next) => {
        if (
          next.event !== "ToolCallResult" ||
          typeof next.payload.toolCallId !== "string" ||
          !toolInputs.has(next.payload.toolCallId)
        ) {
          return next;
        }

        return {
          ...next,
          payload: {
            ...next.payload,
            input: toolInputs.get(next.payload.toolCallId),
          },
        };
      });

      if (
        (event.type === "tool-output-available" ||
          event.type === "tool-output-error" ||
          event.type === "tool-output-denied") &&
        typeof event.toolCallId === "string"
      ) {
        toolInputs.delete(event.toolCallId);
      }

      return encodedEvents;
    },
    finalize: (response) => finalizeAgUiBrowserEvents(state, response),
  };
}
