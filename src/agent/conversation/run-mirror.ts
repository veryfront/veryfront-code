import { type ConversationRunEventQueueController } from "./durable.ts";

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
}

/** State for conversation run mirror stopped. */
export interface ConversationRunMirrorStoppedState {
  latestEventId: number;
  latestExternalEventSequence: number;
  pendingEventCount: 0;
  consecutiveFailures: number;
  disabled: true;
  disableReason?: "cursor_resyncs_exhausted" | "non_appendable" | "ignorable_append_rejection";
}

/** State for conversation run mirror retry scheduled. */
export interface ConversationRunMirrorRetryScheduledState {
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
  flush(): Promise<void>;
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
    if (snapshot.disabled || snapshot.pendingEventCount === 0) {
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
    return !snapshot.disabled && !snapshot.inFlight && snapshot.pendingEventCount > 0;
  }

  function shouldContinueFlushLoop(): boolean {
    const snapshot = getSnapshot();
    return !snapshot.disabled && snapshot.consecutiveFailures === 0 && !snapshot.hasRetryTimer &&
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
    if (snapshot.disabled || snapshot.pendingEventCount === 0) {
      return;
    }

    const retryDelayMs = getRetryDelayMs(snapshot.consecutiveFailures);
    clearRetryTimer();
    retryTimer = scheduleMirrorTimer({
      delayMs: retryDelayMs,
      onFire: () => {
        retryTimer = null;
        startFlushLoop();
      },
    });
  }

  async function runFlushLoop(): Promise<void> {
    emitHighBacklogIfNeeded();
    const flushed = await input.queueController.flush();

    if (flushed.outcome === "idle" || flushed.outcome === "flushed") {
      return;
    }

    if (flushed.outcome === "stopped") {
      clearFlushTimer();
      clearRetryTimer();
      await input.onStopped?.(flushed);
      return;
    }

    if (flushed.outcome !== "retry_scheduled") {
      return;
    }

    const retryDelayMs = getRetryDelayMs(flushed.consecutiveFailures);
    await input.onRetryScheduled?.({
      ...flushed,
      retryDelayMs,
    });
    scheduleRetry();
  }

  function startFlushLoop(): void {
    if (!shouldStartFlushLoop()) {
      return;
    }

    inFlightFlush = runFlushLoop().finally(() => {
      inFlightFlush = null;
      if (shouldContinueFlushLoop()) {
        startFlushLoop();
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
      if (snapshot.disabled || events.length === 0) {
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
    async flush() {
      clearFlushTimer();
      clearRetryTimer();
      const snapshot = getSnapshot();
      if (snapshot.disabled || (snapshot.pendingEventCount === 0 && !snapshot.inFlight)) {
        return;
      }

      startFlushLoop();
      await inFlightFlush;
    },
    getSnapshot,
    dispose() {
      clearFlushTimer();
      clearRetryTimer();
    },
  };
}
