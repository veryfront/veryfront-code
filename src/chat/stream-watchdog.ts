import type { ChatUiMessageChunk, MessageMetadata } from "./types.ts";

/** Default value for chat stream idle timeout ms. */
export const DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS = 120_000;
/** Default value for chat stream tool running timeout ms. */
export const DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS = 300_000;
const MAX_TIMER_DURATION_MS = 2_147_483_647;
const MAX_ACTIVE_TOOL_CALLS = 1_024;

/** Public API contract for chat stream watchdog phase. */
export type ChatStreamWatchdogPhase =
  | "response_pending"
  | "tool_input_streaming"
  | "tool_running"
  | "post_tool_idle";

/** State for chat stream watchdog. */
export type ChatStreamWatchdogState = {
  phase: ChatStreamWatchdogPhase;
  timeoutMs: number;
  toolCallId?: string;
  toolName?: string;
};

/** Options accepted by chat stream watchdog. */
export type ChatStreamWatchdogOptions = {
  idleTimeoutMs?: number;
  toolRunningTimeoutMs?: number;
  /**
   * @deprecated Tool execution is always bounded by `toolRunningTimeoutMs`.
   * This option remains accepted for source compatibility and has no effect.
   */
  longRunningToolNames?: Iterable<string>;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
};

/** Controls and observes one chat stream idle watchdog. */
export interface ChatStreamWatchdog {
  readonly signal: AbortSignal;
  readonly lastTimeoutState: ChatStreamWatchdogState | null;
  keepAlive(): void;
  observe(chunk: ChatUiMessageChunk<MessageMetadata>): void;
  dispose(): void;
}

/** Error shape for chat stream idle timeout. */
export class ChatStreamIdleTimeoutError extends Error {
  readonly state: ChatStreamWatchdogState;

  constructor(state: ChatStreamWatchdogState) {
    const toolLabel = typeof state.toolName === "string" && state.toolName.length > 0
      ? ` for ${state.toolName}${state.toolCallId ? ` (${state.toolCallId})` : ""}`
      : state.toolCallId
      ? ` for ${state.toolCallId}`
      : "";
    super(`Chat stream idle timeout after ${state.timeoutMs}ms during ${state.phase}${toolLabel}`);
    this.name = "ChatStreamIdleTimeoutError";
    this.state = state;
  }
}

/** State for create chat stream watchdog. */
export function createChatStreamWatchdogState(
  phase: ChatStreamWatchdogPhase,
  metadata?: {
    toolCallId?: string;
    toolName?: string;
  },
  options: Pick<Required<ChatStreamWatchdogOptions>, "idleTimeoutMs" | "toolRunningTimeoutMs"> = {
    idleTimeoutMs: DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
    toolRunningTimeoutMs: DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
  },
): ChatStreamWatchdogState {
  return {
    phase,
    timeoutMs: phase === "tool_running" ? options.toolRunningTimeoutMs : options.idleTimeoutMs,
    ...(metadata?.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
    ...(metadata?.toolName ? { toolName: metadata.toolName } : {}),
  };
}

/**
 * Check whether a caller-classified long-running tool is active.
 * @deprecated The watchdog no longer exempts tool executions from its deadline.
 */
export function isLongRunningToolRunning(
  current: ChatStreamWatchdogState,
  longRunningToolNames: ReadonlySet<string>,
): boolean {
  return (
    current.phase === "tool_running" &&
    typeof current.toolName === "string" &&
    longRunningToolNames.has(current.toolName)
  );
}

/** State for get next chat stream watchdog. */
export function getNextChatStreamWatchdogState(
  currentState: ChatStreamWatchdogState,
  chunk: ChatUiMessageChunk<MessageMetadata>,
  options?: ChatStreamWatchdogOptions,
): ChatStreamWatchdogState {
  const resolvedOptions = resolveChatStreamWatchdogOptions(options);

  switch (chunk.type) {
    case "tool-input-start":
      return createChatStreamWatchdogState(
        "tool_input_streaming",
        {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
        },
        resolvedOptions,
      );

    case "tool-input-delta":
      return createChatStreamWatchdogState(
        "tool_input_streaming",
        {
          toolCallId: chunk.toolCallId,
          toolName: currentState.toolCallId === chunk.toolCallId
            ? currentState.toolName
            : undefined,
        },
        resolvedOptions,
      );

    case "tool-input-available":
      return createChatStreamWatchdogState(
        "tool_running",
        {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
        },
        resolvedOptions,
      );

    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
      return createChatStreamWatchdogState(
        "post_tool_idle",
        {
          toolCallId: chunk.toolCallId,
          toolName: currentState.toolCallId === chunk.toolCallId
            ? currentState.toolName
            : undefined,
        },
        resolvedOptions,
      );

    case "message-metadata":
      return currentState.phase === "tool_running"
        ? currentState
        : createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);

    case "finish":
      return createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);

    default:
      return currentState.phase === "tool_running"
        ? currentState
        : createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
  }
}

/** Check whether a chunk only carries heartbeat metadata. */
export function isHeartbeatOnlyMetadataChunk(chunk: ChatUiMessageChunk<MessageMetadata>): boolean {
  return chunk.type === "message-metadata" && Object.keys(chunk.messageMetadata ?? {}).length === 0;
}

/** Create chat stream watchdog. */
export function createChatStreamWatchdog(
  options?: ChatStreamWatchdogOptions,
): ChatStreamWatchdog {
  const resolvedOptions = resolveChatStreamWatchdogOptions(options);
  const controller = new AbortController();
  let state = createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTimeoutState: ChatStreamWatchdogState | null = null;
  let disposed = false;
  const activeTools = new Map<string, string>();

  const restoreMostRecentActiveTool = () => {
    let activeTool: [string, string] | undefined;
    for (const entry of activeTools) activeTool = entry;
    if (!activeTool) return;
    state = createChatStreamWatchdogState(
      "tool_running",
      { toolCallId: activeTool[0], toolName: activeTool[1] },
      resolvedOptions,
    );
  };

  const clearTimer = () => {
    if (timer !== null) {
      resolvedOptions.clearTimeoutFn(timer);
      timer = null;
    }
  };

  const arm = () => {
    if (disposed || controller.signal.aborted) {
      return;
    }

    clearTimer();

    timer = resolvedOptions.setTimeoutFn(() => {
      timer = null;
      lastTimeoutState = { ...state };
      controller.abort(
        new DOMException(new ChatStreamIdleTimeoutError(state).message, "AbortError"),
      );
    }, state.timeoutMs);
    maybeUnrefTimer(timer);
  };

  arm();

  return {
    signal: controller.signal,
    get lastTimeoutState(): ChatStreamWatchdogState | null {
      return lastTimeoutState;
    },
    keepAlive() {
      if (disposed || controller.signal.aborted) {
        return;
      }

      arm();
    },
    observe(chunk: ChatUiMessageChunk<MessageMetadata>) {
      if (disposed || controller.signal.aborted) {
        return;
      }

      if (isHeartbeatOnlyMetadataChunk(chunk)) {
        arm();
        return;
      }

      if (chunk.type === "tool-input-available") {
        if (!activeTools.has(chunk.toolCallId) && activeTools.size >= MAX_ACTIVE_TOOL_CALLS) {
          throw new RangeError(
            `Chat stream active tool calls exceed ${MAX_ACTIVE_TOOL_CALLS}`,
          );
        }
        activeTools.delete(chunk.toolCallId);
        activeTools.set(chunk.toolCallId, chunk.toolName);
      } else if (
        chunk.type === "tool-output-available" || chunk.type === "tool-output-error" ||
        chunk.type === "tool-output-denied"
      ) {
        activeTools.delete(chunk.toolCallId);
      }

      state = getNextChatStreamWatchdogState(state, chunk, resolvedOptions);
      if (
        activeTools.size > 0 &&
        (chunk.type === "tool-output-available" || chunk.type === "tool-output-error" ||
          chunk.type === "tool-output-denied" || chunk.type === "message-metadata" ||
          (chunk.type !== "tool-input-start" && chunk.type !== "tool-input-delta" &&
            chunk.type !== "tool-input-available" && chunk.type !== "finish" &&
            chunk.type !== "abort" && chunk.type !== "error"))
      ) {
        restoreMostRecentActiveTool();
      }

      if (chunk.type === "finish" || chunk.type === "abort" || chunk.type === "error") {
        activeTools.clear();
        disposed = true;
        clearTimer();
        return;
      }
      arm();
    },
    dispose() {
      activeTools.clear();
      disposed = true;
      clearTimer();
    },
  };
}

function resolveTimerDuration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMER_DURATION_MS) {
    throw new RangeError(`${name} must be a positive safe timer duration`);
  }
  return value;
}

function resolveChatStreamWatchdogOptions(options?: ChatStreamWatchdogOptions) {
  const defaultSetTimeout = globalThis.setTimeout.bind(globalThis);
  const defaultClearTimeout = globalThis.clearTimeout.bind(globalThis);

  return {
    idleTimeoutMs: resolveTimerDuration(
      options?.idleTimeoutMs ?? DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
      "idleTimeoutMs",
    ),
    toolRunningTimeoutMs: resolveTimerDuration(
      options?.toolRunningTimeoutMs ?? DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
      "toolRunningTimeoutMs",
    ),
    setTimeoutFn: options?.setTimeoutFn ?? defaultSetTimeout,
    clearTimeoutFn: options?.clearTimeoutFn ?? defaultClearTimeout,
  };
}

function maybeUnrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer !== "object" || timer === null || !("unref" in timer)) {
    return;
  }

  const timerWithUnref: { unref?: unknown } = timer;
  if (typeof timerWithUnref.unref === "function") {
    timerWithUnref.unref();
  }
}
