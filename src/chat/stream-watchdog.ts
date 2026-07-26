import type { ChatUiMessageChunk, MessageMetadata } from "./types.ts";
import { normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";

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

/** Active tool tracked by a chat stream watchdog. */
export type ChatStreamWatchdogActiveTool = {
  phase: "tool_input_streaming" | "tool_running";
  toolCallId: string;
  toolName?: string;
};

/** State for chat stream watchdog. */
export type ChatStreamWatchdogState = {
  phase: ChatStreamWatchdogPhase;
  timeoutMs: number;
  toolCallId?: string;
  toolName?: string;
  activeToolCalls?: readonly ChatStreamWatchdogActiveTool[];
};

/** Options accepted by chat stream watchdog. */
export type ChatStreamWatchdogOptions = {
  idleTimeoutMs?: number;
  toolRunningTimeoutMs?: number;
  longRunningToolNames?: Iterable<string>;
  longRunningToolPrefixes?: Iterable<string>;
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
  const idleTimeoutMs = requirePositiveTimeout(options.idleTimeoutMs, "idleTimeoutMs");
  const toolRunningTimeoutMs = requirePositiveTimeout(
    options.toolRunningTimeoutMs,
    "toolRunningTimeoutMs",
  );
  return {
    phase,
    timeoutMs: phase === "tool_running" ? toolRunningTimeoutMs : idleTimeoutMs,
    ...(metadata?.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
    ...(metadata?.toolName ? { toolName: metadata.toolName } : {}),
  };
}

/** Check whether a long-running tool is active. */
export function isLongRunningToolRunning(
  current: ChatStreamWatchdogState,
  longRunningToolNames: ReadonlySet<string>,
  longRunningToolPrefixes: readonly string[] = [],
): boolean {
  return (
    current.phase === "tool_running" &&
    typeof current.toolName === "string" &&
    (longRunningToolNames.has(current.toolName) ||
      longRunningToolPrefixes.some(
        (prefix) => prefix.length > 0 && current.toolName?.startsWith(prefix),
      ))
  );
}

function getActiveToolCalls(
  state: ChatStreamWatchdogState,
): ChatStreamWatchdogActiveTool[] {
  if (state.activeToolCalls) {
    return state.activeToolCalls.map((tool) => ({ ...tool }));
  }
  if (
    (state.phase === "tool_input_streaming" || state.phase === "tool_running") &&
    state.toolCallId
  ) {
    return [{
      phase: state.phase,
      toolCallId: state.toolCallId,
      ...(state.toolName ? { toolName: state.toolName } : {}),
    }];
  }
  return [];
}

function isLongRunningTool(
  tool: ChatStreamWatchdogActiveTool,
  options: ReturnType<typeof resolveChatStreamWatchdogOptions>,
): boolean {
  return tool.phase === "tool_running" &&
    typeof tool.toolName === "string" &&
    (
      options.longRunningToolNames.has(tool.toolName) ||
      options.longRunningToolPrefixes.some((prefix) => tool.toolName?.startsWith(prefix))
    );
}

function createActiveToolState(
  activeTools: ChatStreamWatchdogActiveTool[],
  options: ReturnType<typeof resolveChatStreamWatchdogOptions>,
): ChatStreamWatchdogState {
  const selected = activeTools.findLast((tool) => !isLongRunningTool(tool, options)) ??
    activeTools.at(-1);
  if (!selected) {
    return createChatStreamWatchdogState("response_pending", undefined, options);
  }

  return {
    ...createChatStreamWatchdogState(selected.phase, selected, options),
    ...(activeTools.length > 1
      ? { activeToolCalls: activeTools.map((tool) => ({ ...tool })) }
      : {}),
  };
}

function upsertActiveTool(
  currentState: ChatStreamWatchdogState,
  tool: ChatStreamWatchdogActiveTool,
  options: ReturnType<typeof resolveChatStreamWatchdogOptions>,
): ChatStreamWatchdogState {
  const activeTools = getActiveToolCalls(currentState);
  const existingIndex = activeTools.findIndex((active) => active.toolCallId === tool.toolCallId);
  if (existingIndex === -1) {
    activeTools.push(tool);
  } else {
    const existing = activeTools[existingIndex]!;
    activeTools[existingIndex] = {
      ...existing,
      ...tool,
      ...(tool.toolName ?? existing.toolName
        ? { toolName: tool.toolName ?? existing.toolName }
        : {}),
    };
  }
  return createActiveToolState(activeTools, options);
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
      return upsertActiveTool(
        currentState,
        {
          phase: "tool_input_streaming",
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
        },
        resolvedOptions,
      );

    case "tool-input-delta":
      return upsertActiveTool(
        currentState,
        {
          phase: "tool_input_streaming",
          toolCallId: chunk.toolCallId,
          ...(currentState.toolCallId === chunk.toolCallId && currentState.toolName
            ? { toolName: currentState.toolName }
            : {}),
        },
        resolvedOptions,
      );

    case "tool-input-available":
      return upsertActiveTool(
        currentState,
        {
          phase: "tool_running",
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
        },
        resolvedOptions,
      );

    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied": {
      const activeTools = getActiveToolCalls(currentState);
      const remainingTools = activeTools.filter((tool) => tool.toolCallId !== chunk.toolCallId);
      if (remainingTools.length > 0) {
        return createActiveToolState(remainingTools, resolvedOptions);
      }
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
    }

    case "finish":
      return createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);

    default: {
      const activeTools = getActiveToolCalls(currentState);
      return activeTools.length > 0
        ? createActiveToolState(activeTools, resolvedOptions)
        : createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
    }
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
  let disposed = false;

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

    if (
      isLongRunningToolRunning(
        state,
        resolvedOptions.longRunningToolNames,
        resolvedOptions.longRunningToolPrefixes,
      )
    ) {
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
      if (disposed) {
        return;
      }
      if (
        isLongRunningToolRunning(
          state,
          resolvedOptions.longRunningToolNames,
          resolvedOptions.longRunningToolPrefixes,
        )
      ) {
        return;
      }

      if (getActiveToolCalls(state).length === 0) {
        state = createChatStreamWatchdogState("response_pending", undefined, resolvedOptions);
      }
      arm();
    },
    observe(chunk: ChatUiMessageChunk<MessageMetadata>) {
      if (disposed) {
        return;
      }
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
      disposed = true;
      clearTimer();
    },
  };
}

function resolveChatStreamWatchdogOptions(options?: ChatStreamWatchdogOptions) {
  const defaultSetTimeout = globalThis.setTimeout.bind(globalThis);
  const defaultClearTimeout = globalThis.clearTimeout.bind(globalThis);

  return {
    idleTimeoutMs: requirePositiveTimeout(
      options?.idleTimeoutMs ?? DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
      "idleTimeoutMs",
    ),
    toolRunningTimeoutMs: requirePositiveTimeout(
      options?.toolRunningTimeoutMs ?? DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
      "toolRunningTimeoutMs",
    ),
    // Default to an empty set — callers must opt in to exempt specific tool names
    // from the idle timeout. Embedding product-specific names here as a default
    // couples this shared utility to application concerns.
    longRunningToolNames: new Set(options?.longRunningToolNames ?? []),
    longRunningToolPrefixes: normalizeLongRunningToolPrefixes(
      options?.longRunningToolPrefixes ?? [],
    ),
    setTimeoutFn: options?.setTimeoutFn ?? defaultSetTimeout,
    clearTimeoutFn: options?.clearTimeoutFn ?? defaultClearTimeout,
  };
}

function requirePositiveTimeout(value: number, optionName: string): number {
  const normalized = normalizeTimerDurationMs(
    value,
    `Chat stream watchdog ${optionName}`,
  );
  if (normalized === 0) {
    throw new RangeError(`Chat stream watchdog ${optionName} must be greater than zero`);
  }
  return normalized;
}

function normalizeLongRunningToolPrefixes(prefixes: Iterable<string>): string[] {
  const normalized = [...prefixes];
  if (
    normalized.some((prefix) =>
      typeof prefix !== "string" || prefix.length === 0 || prefix.trim().length === 0
    )
  ) {
    throw new TypeError(
      "Chat stream watchdog longRunningToolPrefixes must contain non-empty strings",
    );
  }
  return normalized;
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
