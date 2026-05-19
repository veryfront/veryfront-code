import { throwIfChildRunAborted } from "../child-run/execution-support.ts";

/** Public API contract for hosted child stream watchdog phase. */
export type HostedChildStreamWatchdogPhase = "tool_running" | "post_tool_idle" | "generic_idle";

/** State for hosted child stream watchdog. */
export interface HostedChildStreamWatchdogState {
  phase: HostedChildStreamWatchdogPhase;
  timeoutMs: number;
}

/** Error shape for hosted child stream idle timeout. */
export class HostedChildStreamIdleTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly phase: HostedChildStreamWatchdogPhase;

  constructor(input: HostedChildStreamWatchdogState) {
    super(
      `Child fork stream stalled after ${
        Math.round(input.timeoutMs / 1000)
      }s without yielding a new event.`,
    );
    this.name = "HostedChildStreamIdleTimeoutError";
    this.timeoutMs = input.timeoutMs;
    this.phase = input.phase;
  }
}

/** Shared hosted child stream timeout token value. */
export const HOSTED_CHILD_STREAM_TIMEOUT_TOKEN = Symbol("hosted-child-stream-timeout");

/** State for resolve hosted child stream watchdog. */
export function resolveHostedChildStreamWatchdogState(input: {
  activeToolCallId: string | null;
  completedToolResults: number;
  idleTimeoutMs: number;
  activeToolTimeoutMs: number;
  postToolIdleTimeoutMs: number;
}): HostedChildStreamWatchdogState {
  if (input.activeToolCallId) {
    return {
      phase: "tool_running",
      timeoutMs: input.activeToolTimeoutMs,
    };
  }

  if (input.completedToolResults > 0) {
    return {
      phase: "post_tool_idle",
      timeoutMs: input.postToolIdleTimeoutMs,
    };
  }

  return {
    phase: "generic_idle",
    timeoutMs: input.idleTimeoutMs,
  };
}

/** Compose abort signals helper. */
export function composeAbortSignals(
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal != null);
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }
  return AbortSignal.any(activeSignals);
}

/** Applies hosted child stream idle timeout. */
export async function* withHostedChildStreamIdleTimeout<T>(input: {
  stream: AsyncIterable<T>;
  getWatchdogState: () => HostedChildStreamWatchdogState;
  abortSignal?: AbortSignal;
  onIdleTimeout?: (
    state: HostedChildStreamWatchdogState,
  ) => undefined | "continue" | Promise<undefined | "continue">;
}): AsyncGenerator<T, void, void> {
  const iterator = input.stream[Symbol.asyncIterator]();
  let pendingNext: Promise<IteratorResult<T>> | null = null;

  while (true) {
    throwIfChildRunAborted(input.abortSignal);

    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const watchdogState = input.getWatchdogState();
    if (!pendingNext) {
      pendingNext = iterator.next();
    }

    try {
      const result = await Promise.race<
        IteratorResult<T> | typeof HOSTED_CHILD_STREAM_TIMEOUT_TOKEN
      >([
        pendingNext,
        new Promise<typeof HOSTED_CHILD_STREAM_TIMEOUT_TOKEN>((resolve) => {
          timeoutId = globalThis.setTimeout(() => {
            resolve(HOSTED_CHILD_STREAM_TIMEOUT_TOKEN);
          }, watchdogState.timeoutMs);
        }),
      ]);

      if (result === HOSTED_CHILD_STREAM_TIMEOUT_TOKEN) {
        const action = await input.onIdleTimeout?.(watchdogState);
        if (action === "continue") {
          continue;
        }

        throw new HostedChildStreamIdleTimeoutError(watchdogState);
      }

      pendingNext = null;

      if (result.done) {
        return;
      }

      yield result.value;
    } finally {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }
}

/** Resolves hosted child promise with timeout. */
export async function resolveHostedChildPromiseWithTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
): Promise<T | typeof HOSTED_CHILD_STREAM_TIMEOUT_TOKEN> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<typeof HOSTED_CHILD_STREAM_TIMEOUT_TOKEN>((resolve) => {
        timeoutId = globalThis.setTimeout(
          () => resolve(HOSTED_CHILD_STREAM_TIMEOUT_TOKEN),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}
