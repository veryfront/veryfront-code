import type { ChatUiMessageChunk, MessageMetadata } from "./types.ts";

/** Default value for chat stream idle timeout ms. */
export const DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS = 120_000;
/** Default value for chat stream tool running timeout ms. */
export const DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS = 300_000;

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
  longRunningToolNames?: Iterable<string>;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
};

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

/** Check whether a long-running tool is active. */
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
      return isLongRunningToolRunning(currentState, resolvedOptions.longRunningToolNames)
        ? currentState
        : createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);

    case "finish":
      return createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);

    default:
      return isLongRunningToolRunning(currentState, resolvedOptions.longRunningToolNames)
        ? currentState
        : createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
  }
}

/** Check whether a chunk only carries heartbeat metadata. */
export function isHeartbeatOnlyMetadataChunk(chunk: ChatUiMessageChunk<MessageMetadata>): boolean {
  return chunk.type === "message-metadata" && Object.keys(chunk.messageMetadata ?? {}).length === 0;
}

/** Create chat stream watchdog. */
export function createChatStreamWatchdog(options?: ChatStreamWatchdogOptions) {
  const resolvedOptions = resolveChatStreamWatchdogOptions(options);
  const controller = new AbortController();
  let state = createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTimeoutState: ChatStreamWatchdogState | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      resolvedOptions.clearTimeoutFn(timer);
      timer = null;
    }
  };

  const arm = () => {
    if (controller.signal.aborted) {
      return;
    }

    clearTimer();

    if (isLongRunningToolRunning(state, resolvedOptions.longRunningToolNames)) {
      return;
    }

    timer = resolvedOptions.setTimeoutFn(() => {
      lastTimeoutState = state;
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
      if (isLongRunningToolRunning(state, resolvedOptions.longRunningToolNames)) {
        return;
      }

      state = createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
      arm();
    },
    observe(chunk: ChatUiMessageChunk<MessageMetadata>) {
      if (isHeartbeatOnlyMetadataChunk(chunk)) {
        return;
      }

      state = getNextChatStreamWatchdogState(state, chunk, resolvedOptions);
      if (chunk.type === "finish") {
        clearTimer();
        return;
      }
      arm();
    },
    dispose() {
      clearTimer();
    },
  };
}

function resolveChatStreamWatchdogOptions(options?: ChatStreamWatchdogOptions) {
  const defaultSetTimeout = globalThis.setTimeout.bind(globalThis);
  const defaultClearTimeout = globalThis.clearTimeout.bind(globalThis);

  return {
    idleTimeoutMs: options?.idleTimeoutMs ?? DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
    toolRunningTimeoutMs: options?.toolRunningTimeoutMs ??
      DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
    longRunningToolNames: new Set(options?.longRunningToolNames ?? ["invoke_agent"]),
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
