import type {
  StreamLifecycleError,
  StreamLifecycleFrame,
  StreamLifecyclePhase,
  StreamProtocolEvent,
  StreamSignal,
  StreamSnapshot,
  StreamToolSnapshot,
} from "./types.ts";

export interface StreamReducerState {
  snapshot: StreamSnapshot;
  sequence: number;
  activeTextId: string | null;
  activeReasoningId: string | null;
  nextTextIndex: number;
  tools: Map<string, StreamToolSnapshot>;
  terminal: boolean;
  terminalError: StreamLifecycleError | null;
}

export interface StreamReduction {
  state: StreamReducerState;
  frames: StreamLifecycleFrame[];
  semanticProgress: boolean;
}

export function createInitialReducerState(): StreamReducerState {
  return {
    snapshot: {
      phase: "awaiting_first_progress",
      accumulatedText: "",
      reasoning: [],
      tools: [],
      finishReason: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      hasStreamOutput: false,
      hasSemanticProgress: false,
    },
    sequence: 0,
    activeTextId: null,
    activeReasoningId: null,
    nextTextIndex: 0,
    tools: new Map(),
    terminal: false,
    terminalError: null,
  };
}

export function reduceStreamSignal(
  current: StreamReducerState,
  signal: StreamSignal,
  elapsedMs: number,
): StreamReduction {
  let state = cloneReducerState(current);
  const frames: StreamLifecycleFrame[] = [];
  let semanticProgress = false;
  const emit = (
    frame: Omit<StreamLifecycleFrame, "sequence" | "elapsedMs">,
  ) =>
    frames.push(
      { ...frame, sequence: ++state.sequence, elapsedMs } as StreamLifecycleFrame,
    );

  if (state.terminal) {
    emit({ class: "diagnostic", event: { type: "provider_part_rejected" } });
    return { state, frames, semanticProgress };
  }

  if (signal.kind === "usage") {
    state.snapshot = { ...state.snapshot, usage: signal.usage };
    emit({ class: "semantic", event: { type: "usage", usage: signal.usage } });
    return { state, frames, semanticProgress };
  }
  if (signal.kind === "provider_error") {
    return { state, frames, semanticProgress };
  }
  if (signal.kind === "diagnostic_candidate") {
    return { state, frames, semanticProgress };
  }

  const closeReasoning = () => {
    if (state.activeReasoningId === null) return;
    emit({
      class: "semantic",
      event: { type: "reasoning_end", id: state.activeReasoningId },
    });
    state.activeReasoningId = null;
  };
  const closeText = () => {
    if (state.activeTextId === null) return;
    emit({
      class: "semantic",
      event: { type: "text_end", id: state.activeTextId },
    });
    state.activeTextId = null;
  };
  const markProgress = () => {
    semanticProgress = true;
    state.snapshot = {
      ...state.snapshot,
      phase: "streaming",
      hasSemanticProgress: true,
    };
  };

  switch (signal.event.type) {
    case "reasoning_start":
      closeText();
      closeReasoning();
      state.activeReasoningId = signal.event.id;
      emit({ class: "semantic", event: signal.event });
      break;
    case "reasoning_content": {
      closeText();
      if (state.activeReasoningId !== signal.event.id) {
        closeReasoning();
        state.activeReasoningId = signal.event.id;
        emit({
          class: "semantic",
          event: { type: "reasoning_start", id: signal.event.id },
        });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_reasoning_start" },
        });
      }
      const reasoning = [...state.snapshot.reasoning];
      const index = reasoning.findIndex((part) => part.id === signal.event.id);
      const prior = index >= 0 ? reasoning[index] : { id: signal.event.id, text: "" };
      const updated = { ...prior, text: prior.text + signal.event.delta };
      if (index >= 0) reasoning[index] = updated;
      else reasoning.push(updated);
      state.snapshot = { ...state.snapshot, reasoning };
      emit({ class: "semantic", event: signal.event });
      if (signal.event.delta.length > 0) markProgress();
      break;
    }
    case "reasoning_end":
      if (state.activeReasoningId === signal.event.id) {
        emit({ class: "semantic", event: signal.event });
        state.activeReasoningId = null;
      }
      break;
    case "text_start":
      closeReasoning();
      closeText();
      state.activeTextId = `text:${state.nextTextIndex++}`;
      emit({
        class: "semantic",
        event: { type: "text_start", id: state.activeTextId },
      });
      break;
    case "text_content":
      closeReasoning();
      if (state.activeTextId === null) {
        state.activeTextId = `text:${state.nextTextIndex++}`;
        emit({
          class: "semantic",
          event: { type: "text_start", id: state.activeTextId },
        });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_text_start" },
        });
      }
      state.snapshot = {
        ...state.snapshot,
        accumulatedText: state.snapshot.accumulatedText + signal.event.delta,
        hasStreamOutput: state.snapshot.hasStreamOutput ||
          signal.event.delta.length > 0,
      };
      emit({
        class: "semantic",
        event: { ...signal.event, id: state.activeTextId },
      });
      if (signal.event.delta.length > 0) markProgress();
      break;
    case "text_end":
      closeText();
      break;
    case "custom":
      if (signal.event.name === "tool-call-status") {
        const data = signal.event.data as {
          toolCallId?: unknown;
          status?: unknown;
        };
        if (
          typeof data.toolCallId === "string" &&
          (data.status === "pending_input" || data.status === "streaming_input")
        ) {
          emit({
            class: "telemetry",
            event: {
              type: "tool_input_status",
              toolCallId: data.toolCallId,
              status: data.status,
            },
          });
        }
      } else {
        emit({ class: "semantic", event: signal.event });
      }
      break;
    default:
      ({ state, semanticProgress } = reduceNonTextProtocolEvent(
        state,
        signal.event,
        elapsedMs,
        emit,
        semanticProgress,
      ));
  }

  if (semanticProgress && !state.snapshot.hasSemanticProgress) {
    state.snapshot = { ...state.snapshot, hasSemanticProgress: true };
  }
  return { state, frames, semanticProgress };
}

type FrameEmitter = (
  frame: Omit<StreamLifecycleFrame, "sequence" | "elapsedMs">,
) => void;

function cloneReducerState(current: StreamReducerState): StreamReducerState {
  return {
    ...current,
    snapshot: {
      ...current.snapshot,
      reasoning: current.snapshot.reasoning.map((part) => ({ ...part })),
      tools: current.snapshot.tools.map((tool) => ({
        ...tool,
        inputDeltas: [...tool.inputDeltas],
      })),
      usage: { ...current.snapshot.usage },
    },
    tools: new Map(
      [...current.tools].map(([id, tool]) => [id, {
        ...tool,
        inputDeltas: [...tool.inputDeltas],
      }]),
    ),
    terminalError: current.terminalError ? { ...current.terminalError } : null,
  };
}

function reduceNonTextProtocolEvent(
  state: StreamReducerState,
  _event: StreamProtocolEvent,
  _elapsedMs: number,
  emit: FrameEmitter,
  semanticProgress: boolean,
): Pick<StreamReduction, "state" | "semanticProgress"> {
  emit({ class: "diagnostic", event: { type: "provider_part_rejected" } });
  return { state, semanticProgress };
}
