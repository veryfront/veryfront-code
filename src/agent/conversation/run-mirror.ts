import { type ConversationRunEventQueueController } from "./durable.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils";

export type ConversationRunMirrorDisableReason =
  | "cursor_resyncs_exhausted"
  | "cursor_mismatch_ambiguous"
  | "non_appendable"
  | "ignorable_append_rejection"
  | "run_terminal"
  | "payload_too_large"
  | "auth_rejected";

/** Public API contract for conversation run mirror snapshot. */
export interface ConversationRunMirrorSnapshot {
  latestEventId: number;
  latestExternalEventSequence: number;
  pendingEventCount: number;
  consecutiveFailures: number;
  disabled: boolean;
  hasFlushTimer: boolean;
  hasRetryTimer: boolean;
  inFlight: boolean;
  appendRequestCount?: number;
  disableReason?: ConversationRunMirrorDisableReason;
}

/** State for conversation run mirror stopped. */
export interface ConversationRunMirrorStoppedState {
  outcome: "stopped";
  latestEventId: number;
  latestExternalEventSequence: number;
  pendingEventCount: 0;
  consecutiveFailures: number;
  disabled: true;
  disableReason?: ConversationRunMirrorDisableReason;
}

/** State for conversation run mirror retry scheduled. */
export interface ConversationRunMirrorRetryScheduledState {
  outcome: "retry_scheduled";
  latestEventId: number;
  latestExternalEventSequence: number;
  pendingEventCount: number;
  consecutiveFailures: number;
  disabled: false;
  errorMessage: string;
  retryDelayMs: number;
}

export interface ConversationRunMirrorHighBacklogState {
  latestEventId: number;
  latestExternalEventSequence: number;
  pendingEventCount: number;
  consecutiveFailures: number;
  disabled: false;
  threshold: number;
}

/** Public API contract for conversation run mirror. */
export interface ConversationRunMirror {
  enqueue(events: unknown[]): void;
  flush(options?: {
    abortSignal?: AbortSignal;
    throwOnTimeoutRetry?: boolean;
  }): Promise<ConversationRunMirrorSnapshot>;
  getSnapshot(): ConversationRunMirrorSnapshot;
  dispose(): void;
}

const DEFAULT_FLUSH_DELAY_MS = 50;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;

function getDefaultRetryDelayMs(consecutiveFailures: number): number {
  const multiplier = 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(DEFAULT_RETRY_BASE_DELAY_MS * multiplier, DEFAULT_RETRY_MAX_DELAY_MS);
}

function clearMirrorTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer !== null) {
    clearTimeout(timer);
  }
  return null;
}

function scheduleMirrorTimer(input: {
  delayMs: number;
  onFire: () => void;
}): ReturnType<typeof setTimeout> {
  return setTimeout(input.onFire, input.delayMs);
}

/** Create conversation run mirror. */
export function createConversationRunMirror(input: {
  queueController: ConversationRunEventQueueController;
  immediateFlushEventCount: number;
  flushDelayMs?: number;
  getRetryDelayMs?: (consecutiveFailures: number) => number;
  highBacklogEventCount?: number;
  onHighBacklog?: (state: ConversationRunMirrorHighBacklogState) => Promise<void> | void;
  onRetryScheduled?: (state: ConversationRunMirrorRetryScheduledState) => Promise<void> | void;
  onStopped?: (state: ConversationRunMirrorStoppedState) => Promise<void> | void;
}): ConversationRunMirror {
  const flushDelayMs = input.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const getRetryDelayMs = input.getRetryDelayMs ?? getDefaultRetryDelayMs;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightFlush: Promise<void> | null = null;
  // Failures that escaped the queue controller (which only counts append
  // failures it recovered itself) still need to back off exponentially, and
  // explicit flush() calls must surface them so callers do not finalize a run
  // while its last events are still queued.
  let escapedFlushFailures = 0;
  let escapedFlushError: { error: unknown } | null = null;
  let retryCause: "timeout" | null = null;
  let disposed = false;
  const lifecycleAbortController = new AbortController();

  function getSnapshot(): ConversationRunMirrorSnapshot {
    const snapshot = input.queueController.getSnapshot();
    return {
      ...snapshot,
      hasFlushTimer: flushTimer !== null,
      hasRetryTimer: retryTimer !== null,
      inFlight: inFlightFlush !== null,
    };
  }

  function clearFlushTimer(): void {
    flushTimer = clearMirrorTimer(flushTimer);
  }

  function clearRetryTimer(): void {
    retryTimer = clearMirrorTimer(retryTimer);
  }

  function shouldSkipScheduledFlush(delayMs: number): boolean {
    const snapshot = getSnapshot();
    if (disposed || snapshot.disabled || snapshot.pendingEventCount === 0) {
      return true;
    }

    if (delayMs === 0) {
      return false;
    }

    if (snapshot.inFlight || snapshot.hasFlushTimer) {
      return true;
    }

    return snapshot.hasRetryTimer && delayMs >= getRetryDelayMs(snapshot.consecutiveFailures);
  }

  function shouldStartFlushLoop(): boolean {
    const snapshot = getSnapshot();
    return !disposed && !snapshot.disabled && !snapshot.inFlight && snapshot.pendingEventCount > 0;
  }

  function shouldContinueFlushLoop(): boolean {
    const snapshot = getSnapshot();
    return !disposed && !snapshot.disabled && snapshot.consecutiveFailures === 0 &&
      !snapshot.hasRetryTimer &&
      snapshot.pendingEventCount > 0;
  }

  function emitHighBacklogIfNeeded(): void {
    if (!input.onHighBacklog || input.highBacklogEventCount === undefined) {
      return;
    }

    const snapshot = getSnapshot();
    if (snapshot.disabled || snapshot.pendingEventCount < input.highBacklogEventCount) {
      return;
    }

    Promise.resolve(
      input.onHighBacklog({
        latestEventId: snapshot.latestEventId,
        latestExternalEventSequence: snapshot.latestExternalEventSequence,
        pendingEventCount: snapshot.pendingEventCount,
        consecutiveFailures: snapshot.consecutiveFailures,
        disabled: false,
        threshold: input.highBacklogEventCount,
      }),
    ).catch(() => {
      // Observability hooks must not interrupt durable mirror flushing.
    });
  }

  function scheduleRetry(): void {
    const snapshot = getSnapshot();
    if (disposed || snapshot.disabled || snapshot.pendingEventCount === 0) {
      return;
    }

    const retryDelayMs = getRetryDelayMs(
      Math.max(snapshot.consecutiveFailures, escapedFlushFailures),
    );
    clearRetryTimer();
    retryTimer = scheduleMirrorTimer({
      delayMs: retryDelayMs,
      onFire: () => {
        retryTimer = null;
        startFlushLoop();
      },
    });
  }

  async function runFlushLoop(abortSignal?: AbortSignal): Promise<void> {
    emitHighBacklogIfNeeded();
    const flushed = await input.queueController.flush({
      abortSignal: abortSignal ?? lifecycleAbortController.signal,
    });
    escapedFlushFailures = 0;
    escapedFlushError = null;

    if (flushed.outcome === "idle" || flushed.outcome === "flushed") {
      retryCause = null;
      return;
    }

    if (flushed.outcome === "stopped") {
      retryCause = null;
      clearFlushTimer();
      clearRetryTimer();
      await input.onStopped?.(flushed);
      return;
    }

    if (flushed.outcome !== "retry_scheduled") {
      return;
    }

    retryCause = flushed.retryCause ?? null;

    const retryDelayMs = getRetryDelayMs(flushed.consecutiveFailures);
    await input.onRetryScheduled?.({
      outcome: "retry_scheduled",
      latestEventId: flushed.latestEventId,
      latestExternalEventSequence: flushed.latestExternalEventSequence,
      pendingEventCount: flushed.pendingEventCount,
      consecutiveFailures: flushed.consecutiveFailures,
      disabled: false,
      errorMessage: flushed.errorMessage,
      retryDelayMs,
    });
    scheduleRetry();
  }

  function startFlushLoop(abortSignal?: AbortSignal): void {
    if (!shouldStartFlushLoop()) {
      return;
    }

    inFlightFlush = runFlushLoop(abortSignal)
      .catch((error) => {
        // The queue controller re-queues its events before rethrowing, so an
        // error escaping here (unexpected controller failure or a throwing
        // observability callback) must not become an unhandled rejection from
        // a timer-triggered loop — back off and retry instead. Explicit
        // flush() rethrows it from the recorded value.
        escapedFlushFailures += 1;
        escapedFlushError = { error };
        if (!disposed) scheduleRetry();
      })
      .finally(() => {
        inFlightFlush = null;
        if (shouldContinueFlushLoop()) {
          startFlushLoop(abortSignal);
        }
      });
  }

  function scheduleFlush(delayMs: number): void {
    if (shouldSkipScheduledFlush(delayMs)) {
      return;
    }

    if (delayMs === 0) {
      clearFlushTimer();
      clearRetryTimer();
      startFlushLoop();
      return;
    }

    clearRetryTimer();
    flushTimer = scheduleMirrorTimer({
      delayMs,
      onFire: () => {
        flushTimer = null;
        startFlushLoop();
      },
    });
  }

  return {
    enqueue(events) {
      const snapshot = getSnapshot();
      if (disposed || snapshot.disabled || events.length === 0) {
        return;
      }

      input.queueController.enqueue(events);
      const nextSnapshot = getSnapshot();
      if (nextSnapshot.pendingEventCount >= input.immediateFlushEventCount) {
        scheduleFlush(0);
        return;
      }

      scheduleFlush(flushDelayMs);
    },
    async flush(options) {
      clearFlushTimer();
      clearRetryTimer();
      const snapshot = getSnapshot();
      if (
        disposed || snapshot.disabled || (snapshot.pendingEventCount === 0 && !snapshot.inFlight)
      ) {
        return snapshot;
      }

      // An already-in-flight loop may have snapshotted the queue before the
      // caller's events were enqueued, and its completion can chain another
      // loop; keep draining until the queue is empty or a retry backoff or
      // stop takes over.
      startFlushLoop(options?.abortSignal);
      while (inFlightFlush !== null) {
        await inFlightFlush;
        const drained = getSnapshot();
        if (!drained.disabled && drained.pendingEventCount > 0 && !drained.hasRetryTimer) {
          startFlushLoop(options?.abortSignal);
        }
      }

      if (escapedFlushError !== null) {
        // Callers like hosted finalization treat a resolved flush() as "safe
        // to complete the run"; a flush error that escaped the controller
        // must reject here instead of silently leaving events queued.
        throw escapedFlushError.error;
      }

      if (options?.throwOnTimeoutRetry && retryCause === "timeout") {
        throw TIMEOUT_ERROR.create({
          detail: "Append conversation run events timed out",
        });
      }

      return getSnapshot();
    },
    getSnapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycleAbortController.abort(
        new DOMException("Conversation run mirror was disposed", "AbortError"),
      );
      clearFlushTimer();
      clearRetryTimer();
      input.queueController.dispose?.();
      // A retry scheduled after an escaped flush error is cancelled above; if
      // events are still queued they will never be flushed, so surface the
      // loss loudly instead of dropping it silently.
      if (escapedFlushError !== null) {
        const { pendingEventCount } = getSnapshot();
        if (pendingEventCount > 0) {
          agentLogger.warn(
            "Conversation run mirror disposed with unflushed events after an escaped flush error; dropping queued events",
            {
              pendingEventCount,
              errorName: escapedFlushError.error instanceof Error
                ? escapedFlushError.error.name
                : typeof escapedFlushError.error,
            },
          );
        }
      }
    },
  };
}
