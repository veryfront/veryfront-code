import {
  mergeToolInputDelta,
  stripLeadingEmptyObjectPlaceholder,
} from "#veryfront/agent/streaming/data-stream.ts";
import { parseCanonicalToolInput } from "./tool-input.ts";
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
      const { id, delta } = signal.event;
      if (state.activeReasoningId !== id) {
        closeReasoning();
        state.activeReasoningId = id;
        emit({
          class: "semantic",
          event: { type: "reasoning_start", id },
        });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_reasoning_start" },
        });
      }
      const reasoning = [...state.snapshot.reasoning];
      const index = reasoning.findIndex((part) => part.id === id);
      const prior = (index >= 0 ? reasoning[index] : undefined) ??
        { id, text: "" };
      const updated = { ...prior, text: prior.text + delta };
      if (index >= 0) reasoning[index] = updated;
      else reasoning.push(updated);
      state.snapshot = { ...state.snapshot, reasoning };
      emit({ class: "semantic", event: signal.event });
      if (delta.length > 0) markProgress();
      break;
    }
    case "reasoning_end": {
      if (state.activeReasoningId !== signal.event.id) break;
      const { id, signature, redactedData } = signal.event;
      if (signature !== undefined || redactedData !== undefined) {
        state.snapshot = {
          ...state.snapshot,
          reasoning: state.snapshot.reasoning.map((part) =>
            part.id === id
              ? {
                ...part,
                ...(signature !== undefined ? { signature } : {}),
                ...(redactedData !== undefined ? { redactedData } : {}),
              }
              : part
          ),
        };
      }
      emit({ class: "semantic", event: signal.event });
      state.activeReasoningId = null;
      break;
    }
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
  event: StreamProtocolEvent,
  elapsedMs: number,
  emit: FrameEmitter,
  semanticProgress: boolean,
): Pick<StreamReduction, "state" | "semanticProgress"> {
  switch (event.type) {
    case "message_start":
    case "step_start":
      emit({ class: "semantic", event });
      return { state, semanticProgress };

    case "tool_input_start": {
      closeOpenContent(state, emit);
      state.tools.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        phase: "input_open",
        inputText: "",
        inputDeltas: [],
        ...(event.providerExecuted !== undefined
          ? { providerExecuted: event.providerExecuted }
          : {}),
        ...(event.dynamic ? { dynamic: true } : {}),
      });
      syncToolSnapshot(state, "awaiting_tool_input");
      emit({ class: "semantic", event });
      return { state, semanticProgress };
    }

    case "tool_input_content": {
      const tool = state.tools.get(event.toolCallId);
      if (!tool || tool.phase === "input_rejected") {
        return failProtocol(state, emit, elapsedMs);
      }
      const inputText = mergeToolInputDelta(tool.inputText, event.delta);
      state.tools.set(event.toolCallId, {
        ...tool,
        phase: "input_streaming",
        inputText,
        inputDeltas: [...tool.inputDeltas, event.delta],
      });
      syncToolSnapshot(state, "awaiting_tool_input");
      emit({ class: "semantic", event });
      return { state, semanticProgress: inputText !== tool.inputText };
    }

    case "tool_input_ready": {
      const prior = state.tools.get(event.toolCallId);
      if (!prior) {
        emit({
          class: "semantic",
          event: {
            type: "tool_input_start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            ...(event.providerExecuted !== undefined
              ? { providerExecuted: event.providerExecuted }
              : {}),
            ...(event.dynamic ? { dynamic: true } : {}),
          },
        });
        emit({
          class: "diagnostic",
          event: { type: "protocol_repair", code: "implicit_tool_input_start" },
        });
      }
      state.tools.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        phase: "input_ready",
        inputText: prior?.inputText ?? JSON.stringify(event.input ?? null),
        inputDeltas: prior?.inputDeltas ?? [],
        input: event.input,
        ...(event.providerExecuted !== undefined
          ? { providerExecuted: event.providerExecuted }
          : {}),
        ...(event.dynamic ? { dynamic: true } : {}),
      });
      syncToolSnapshot(state, "awaiting_tool_input");
      emit({ class: "semantic", event });
      return { state, semanticProgress: true };
    }

    case "tool_input_rejected": {
      const prior = state.tools.get(event.toolCallId);
      state.tools.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        phase: "input_rejected",
        inputText: prior?.inputText ?? "",
        inputDeltas: prior?.inputDeltas ?? [],
        rejectionReason: event.reason,
      });
      syncToolSnapshot(state, "awaiting_tool_input");
      emit({ class: "semantic", event });
      return { state, semanticProgress };
    }

    case "provider_tool_start": {
      const tool = state.tools.get(event.toolCallId);
      if (
        !tool || tool.providerExecuted !== true || tool.phase !== "input_ready"
      ) {
        return failProtocol(state, emit, elapsedMs);
      }
      state.tools.set(event.toolCallId, { ...tool, phase: "running" });
      syncToolSnapshot(state, "streaming");
      emit({ class: "semantic", event });
      return { state, semanticProgress };
    }

    case "provider_tool_result":
    case "provider_tool_denied":
    case "provider_tool_cancelled": {
      const tool = state.tools.get(event.toolCallId);
      if (!tool || tool.providerExecuted !== true || tool.phase !== "running") {
        return failProtocol(state, emit, elapsedMs);
      }
      const phase = event.type === "provider_tool_result"
        ? event.isError ? "failed" : "succeeded"
        : event.type === "provider_tool_denied"
        ? "denied"
        : "cancelled";
      state.tools.set(event.toolCallId, {
        ...tool,
        phase,
        ...(event.type === "provider_tool_result" && !event.isError
          ? { output: event.output }
          : {}),
        ...(event.type === "provider_tool_result" && event.isError ? { error: event.output } : {}),
        ...(event.type === "provider_tool_denied" ? { error: "Tool output denied" } : {}),
        ...(event.type === "provider_tool_cancelled"
          ? { error: "Provider tool execution was cancelled" }
          : {}),
        ...(event.type === "provider_tool_result" &&
            event.preliminary !== undefined
          ? { preliminary: event.preliminary }
          : {}),
      });
      syncToolSnapshot(state, "streaming");
      emit({ class: "semantic", event });
      return { state, semanticProgress: true };
    }

    case "step_finish": {
      closeOpenContent(state, emit);
      if (event.finishReason === "tool-calls") {
        commitPendingLocalInputs(state, emit, elapsedMs);
      }
      emit({ class: "semantic", event });
      const readyLocal = [...state.tools.values()].filter((tool) =>
        tool.phase === "input_ready" && tool.providerExecuted !== true
      );
      const rejectedLocal = [...state.tools.values()].filter((tool) =>
        tool.phase === "input_rejected" && tool.providerExecuted !== true
      );
      const phaseBeforeFinish = state.snapshot.phase;
      const terminalPhase = event.finishReason === "tool-calls" && readyLocal.length > 0
        ? "tool_handoff" as const
        : event.finishReason === "tool-calls"
        ? "failed" as const
        : "completed" as const;
      state.snapshot = {
        ...state.snapshot,
        finishReason: event.finishReason,
        phase: terminalPhase,
        hasSemanticProgress: true,
      };
      if (terminalPhase === "failed") {
        const incomplete = rejectedLocal.some((tool) =>
          tool.rejectionReason === "invalid" ||
          tool.rejectionReason === "malformed"
        );
        state.terminalError = {
          code: incomplete ? "TOOL_INPUT_INCOMPLETE" : "PROTOCOL_VIOLATION",
          phase: phaseBeforeFinish,
          source: incomplete ? "tool" : "runtime",
          retryable: false,
          publicMessage: incomplete
            ? "Tool input ended before a valid object was complete"
            : "Provider requested tool handoff without an executable tool call",
        };
      }
      state.terminal = true;
      return { state, semanticProgress: true };
    }

    case "text_start":
    case "text_content":
    case "text_end":
    case "reasoning_start":
    case "reasoning_content":
    case "reasoning_end":
    case "custom":
      throw new Error(`Reducer routing error for ${event.type}`);
  }
}

function closeOpenContent(state: StreamReducerState, emit: FrameEmitter): void {
  if (state.activeReasoningId !== null) {
    emit({
      class: "semantic",
      event: { type: "reasoning_end", id: state.activeReasoningId },
    });
    state.activeReasoningId = null;
  }
  if (state.activeTextId !== null) {
    emit({
      class: "semantic",
      event: { type: "text_end", id: state.activeTextId },
    });
    state.activeTextId = null;
  }
}

function syncToolSnapshot(
  state: StreamReducerState,
  phase: StreamLifecyclePhase,
): void {
  state.snapshot = {
    ...state.snapshot,
    phase,
    tools: [...state.tools.values()].map((tool) => ({ ...tool })),
    hasStreamOutput: state.snapshot.hasStreamOutput ||
      [...state.tools.values()].some((tool) => tool.rejectionReason !== "unavailable"),
  };
}

function failProtocol(
  state: StreamReducerState,
  emit: FrameEmitter,
  _elapsedMs: number,
): Pick<StreamReduction, "state" | "semanticProgress"> {
  const failedFrom = state.snapshot.phase;
  state.terminal = true;
  state.terminalError = {
    code: "PROTOCOL_VIOLATION",
    phase: failedFrom,
    source: "runtime",
    retryable: false,
    publicMessage: "Provider stream violated the lifecycle protocol",
  };
  state.snapshot = { ...state.snapshot, phase: "failed" };
  emit({
    class: "diagnostic",
    event: { type: "protocol_violation", code: "invalid_tool_transition" },
  });
  return { state, semanticProgress: false };
}

function commitPendingLocalInputs(
  state: StreamReducerState,
  emit: FrameEmitter,
  _elapsedMs: number,
): void {
  for (const [toolCallId, tool] of state.tools) {
    if (
      tool.providerExecuted === true ||
      (tool.phase !== "input_open" && tool.phase !== "input_streaming")
    ) continue;

    const parsed = parseCanonicalToolInput(tool.inputText);
    if (parsed.ok) {
      const ready = {
        ...tool,
        phase: "input_ready" as const,
        input: parsed.value,
      };
      state.tools.set(toolCallId, ready);
      emit({
        class: "semantic",
        event: {
          type: "tool_input_ready",
          toolCallId,
          toolName: tool.name,
          input: parsed.value,
          ...(tool.dynamic ? { dynamic: true } : {}),
        },
      });
      continue;
    }

    state.tools.set(toolCallId, {
      ...tool,
      phase: "input_rejected",
      rejectionReason: parsed.reason,
    });
    emit({
      class: "semantic",
      event: {
        type: "tool_input_rejected",
        toolCallId,
        toolName: tool.name,
        reason: parsed.reason,
      },
    });
  }
  syncToolSnapshot(state, state.snapshot.phase);
}

export type LocalToolDeadlineResolution =
  | { kind: "handoff"; reduction: StreamReduction }
  | {
    kind: "failed";
    reduction: StreamReduction;
    code: "TOOL_INPUT_TIMEOUT" | "TOOL_INPUT_INCOMPLETE";
  };

export function resolveLocalToolDeadline(
  current: StreamReducerState,
  _reason: "tool_input_idle" | "tool_commit_grace",
  elapsedMs: number,
): LocalToolDeadlineResolution {
  const state = cloneReducerState(current);
  const frames: StreamLifecycleFrame[] = [];
  const emit: FrameEmitter = (frame) =>
    frames.push(
      { ...frame, sequence: ++state.sequence, elapsedMs } as StreamLifecycleFrame,
    );

  let receivedInput = false;
  for (const [toolCallId, tool] of state.tools) {
    if (tool.providerExecuted === true) continue;
    if (tool.phase !== "input_open" && tool.phase !== "input_streaming") {
      continue;
    }
    const hadInput = stripLeadingEmptyObjectPlaceholder(tool.inputText).length > 0;
    if (hadInput) receivedInput = true;
    const parsed = parseCanonicalToolInput(tool.inputText);
    if (parsed.ok) {
      state.tools.set(toolCallId, {
        ...tool,
        phase: "input_ready",
        input: parsed.value,
      });
      emit({
        class: "semantic",
        event: {
          type: "tool_input_ready",
          toolCallId,
          toolName: tool.name,
          input: parsed.value,
          ...(tool.dynamic ? { dynamic: true } : {}),
        },
      });
      continue;
    }
    state.tools.set(toolCallId, {
      ...tool,
      phase: "input_rejected",
      rejectionReason: parsed.reason,
    });
    if (hadInput) {
      emit({
        class: "semantic",
        event: {
          type: "tool_input_rejected",
          toolCallId,
          toolName: tool.name,
          reason: parsed.reason,
        },
      });
    }
  }

  const ready = [...state.tools.values()].filter((tool) =>
    tool.phase === "input_ready" && tool.providerExecuted !== true
  );
  state.terminal = true;
  if (ready.length > 0) {
    state.snapshot = {
      ...state.snapshot,
      finishReason: "tool-calls",
      phase: "tool_handoff",
      hasSemanticProgress: true,
      tools: [...state.tools.values()].map((tool) => ({ ...tool })),
    };
    return { kind: "handoff", reduction: { state, frames, semanticProgress: true } };
  }
  state.snapshot = {
    ...state.snapshot,
    tools: [...state.tools.values()].map((tool) => ({ ...tool })),
  };
  return {
    kind: "failed",
    reduction: { state, frames, semanticProgress: false },
    code: receivedInput ? "TOOL_INPUT_INCOMPLETE" : "TOOL_INPUT_TIMEOUT",
  };
}
