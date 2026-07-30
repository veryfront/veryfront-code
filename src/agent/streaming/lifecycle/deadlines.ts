import type {
  MonotonicClock,
  StreamLifecyclePolicy,
  StreamProviderDeadlineKind,
  StreamSnapshot,
} from "./types.ts";

export interface TrackedProviderRead<T> {
  readonly promise: Promise<IteratorResult<T>>;
  readonly settled: boolean;
  readonly settledAtMs: number | null;
  readonly result: IteratorResult<T> | null;
  readonly error: unknown;
}

export type StreamReadRace<T> =
  | { kind: "part"; result: IteratorResult<T> }
  | { kind: "read_error"; error: unknown }
  | { kind: "status"; toolCallIds: readonly string[] }
  | { kind: "provider_deadline"; deadline: StreamProviderDeadlineKind }
  | { kind: "attempt_timeout" }
  | { kind: "cancelled" };

export interface StreamDeadlineController {
  readonly attemptDeadlineMs: number;
  resumeProviderWait(snapshot: Readonly<StreamSnapshot>): void;
  pauseProviderWait(): void;
  noteSemanticProgress(snapshot: Readonly<StreamSnapshot>): void;
  raceProviderRead<T>(
    read: TrackedProviderRead<T>,
    signal: AbortSignal,
  ): Promise<StreamReadRace<T>>;
  dispose(): void;
}

export function trackProviderRead<T>(
  promise: Promise<IteratorResult<T>>,
  clock: MonotonicClock,
): TrackedProviderRead<T> {
  let settled = false;
  let settledAtMs: number | null = null;
  let result: IteratorResult<T> | null = null;
  let error: unknown;
  const tracked = promise.then(
    (value) => {
      settled = true;
      settledAtMs = clock.nowMs();
      result = value;
      return value;
    },
    (caught) => {
      settled = true;
      settledAtMs = clock.nowMs();
      error = caught;
      throw caught;
    },
  );
  void tracked.catch(() => undefined);
  return {
    promise: tracked,
    get settled() {
      return settled;
    },
    get settledAtMs() {
      return settledAtMs;
    },
    get result() {
      return result;
    },
    get error() {
      return error;
    },
  };
}

export function createStreamDeadlineController(input: {
  clock: MonotonicClock;
  policy: StreamLifecyclePolicy;
  attemptDeadlineMs: number;
  disposeSignal: AbortSignal;
}): StreamDeadlineController {
  const { clock, policy, attemptDeadlineMs, disposeSignal } = input;
  let activeKind: StreamProviderDeadlineKind | null = null;
  let remainingMs = 0;
  let deadlineAbsMs: number | null = null;
  let statusDueMs: number | null = null;
  let statusEmitted = false;
  let statusToolIds: string[] = [];
  let waitStartMs: number | null = null;
  let waiting = false;
  let disposed = false;

  const selectKind = (
    snapshot: Readonly<StreamSnapshot>,
  ): StreamProviderDeadlineKind | null => {
    if (
      snapshot.phase === "completed" || snapshot.phase === "failed" ||
      snapshot.phase === "cancelled" || snapshot.phase === "tool_handoff"
    ) {
      return null;
    }
    const localTools = snapshot.tools.filter((tool) => tool.providerExecuted !== true);
    if (localTools.some((tool) => tool.phase === "input_ready")) {
      return "tool_commit_grace";
    }
    if (
      localTools.some((tool) => tool.phase === "input_open" || tool.phase === "input_streaming")
    ) {
      return "tool_input_idle";
    }
    if (!snapshot.hasSemanticProgress) return "first_progress";
    return "semantic_idle";
  };

  const budgetFor = (kind: StreamProviderDeadlineKind): number => {
    switch (kind) {
      case "first_progress":
        return policy.firstProgressTimeoutMs;
      case "semantic_idle":
        return policy.semanticIdleTimeoutMs;
      case "tool_input_idle":
        return policy.toolInputIdleTimeoutMs;
      case "tool_commit_grace":
        return policy.toolCommitGraceMs;
    }
  };

  const refreshStatusTargets = (snapshot: Readonly<StreamSnapshot>): void => {
    statusToolIds = snapshot.tools
      .filter((tool) =>
        tool.providerExecuted !== true &&
        (tool.phase === "input_open" || tool.phase === "input_streaming")
      )
      .map((tool) => tool.id);
  };

  return {
    attemptDeadlineMs,
    resumeProviderWait(snapshot) {
      const now = clock.nowMs();
      const kind = selectKind(snapshot);
      if (kind !== activeKind) {
        activeKind = kind;
        remainingMs = kind === null ? 0 : budgetFor(kind);
      }
      refreshStatusTargets(snapshot);
      if (statusToolIds.length === 0) {
        statusDueMs = null;
        statusEmitted = false;
      } else if (statusDueMs === null || statusEmitted) {
        statusDueMs = now + policy.statusIntervalMs;
        statusEmitted = false;
      }
      deadlineAbsMs = activeKind === null ? null : now + remainingMs;
      waitStartMs = now;
      waiting = true;
    },
    pauseProviderWait() {
      if (!waiting || waitStartMs === null) return;
      const elapsed = clock.nowMs() - waitStartMs;
      remainingMs = Math.max(0, remainingMs - elapsed);
      waiting = false;
      waitStartMs = null;
      deadlineAbsMs = null;
    },
    noteSemanticProgress(snapshot) {
      const kind = selectKind(snapshot);
      activeKind = kind;
      remainingMs = kind === null ? 0 : budgetFor(kind);
      refreshStatusTargets(snapshot);
      if (statusToolIds.length > 0) {
        statusDueMs = clock.nowMs() + policy.statusIntervalMs;
        statusEmitted = false;
      } else {
        statusDueMs = null;
      }
    },
    async raceProviderRead(read, signal) {
      while (true) {
        if (disposed || signal.aborted) return { kind: "cancelled" };
        const now = clock.nowMs();
        if (now >= attemptDeadlineMs) return { kind: "attempt_timeout" };
        if (
          read.settled &&
          (deadlineAbsMs === null || (read.settledAtMs ?? now) <= deadlineAbsMs)
        ) {
          if (read.result !== null) return { kind: "part", result: read.result };
          return { kind: "read_error", error: read.error };
        }
        if (
          deadlineAbsMs !== null && activeKind !== null && now >= deadlineAbsMs
        ) {
          return { kind: "provider_deadline", deadline: activeKind };
        }
        if (statusDueMs !== null && now >= statusDueMs) {
          statusEmitted = true;
          return { kind: "status", toolCallIds: [...statusToolIds] };
        }
        const target = Math.min(
          attemptDeadlineMs,
          deadlineAbsMs ?? Number.POSITIVE_INFINITY,
          statusDueMs ?? Number.POSITIVE_INFINITY,
        );
        const wake = new AbortController();
        const onAbort = () => wake.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        disposeSignal.addEventListener("abort", onAbort, { once: true });
        try {
          await Promise.race([
            clock.waitUntil(target, wake.signal),
            read.promise.then(() => undefined, () => undefined).then(() => wake.abort()),
          ]);
        } finally {
          signal.removeEventListener("abort", onAbort);
          disposeSignal.removeEventListener("abort", onAbort);
          if (!wake.signal.aborted) wake.abort();
        }
      }
    },
    dispose() {
      disposed = true;
    },
  };
}

/**
 * One absolute timer primitive shared by the lifecycle runner and the
 * compatibility watchdog. The callback fires when the schedule elapses;
 * dispose() releases it without firing.
 */
export interface AbsoluteDeadlineTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export function createClockDeadlineTimer(
  clock: MonotonicClock,
): AbsoluteDeadlineTimer {
  return {
    schedule(callback, delayMs) {
      const controller = new AbortController();
      void clock.waitUntil(clock.nowMs() + delayMs, controller.signal).then(
        (result) => {
          if (result === "deadline") callback();
        },
      );
      return controller;
    },
    cancel(handle) {
      const controller = handle as AbortController;
      if (!controller.signal.aborted) controller.abort();
    },
  };
}

export function createAbsoluteDeadline(input: {
  timer: AbsoluteDeadlineTimer;
  delayMs: number;
  onDeadline: () => void;
}) {
  let fired = false;
  let disposed = false;
  const handle = input.timer.schedule(() => {
    if (disposed) return;
    fired = true;
    input.onDeadline();
  }, input.delayMs);
  return {
    dispose() {
      if (disposed || fired) return;
      disposed = true;
      input.timer.cancel(handle);
    },
  };
}
