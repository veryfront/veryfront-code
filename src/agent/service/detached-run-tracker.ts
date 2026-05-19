import { RunResumeSessionManager } from "../runtime/resume-session.ts";

/** Result returned from detached run drain. */
export interface DetachedRunDrainResult {
  drained: boolean;
  pendingRunIds: string[];
}

/** Options accepted by detached run tracker. */
export interface DetachedRunTrackerOptions<TResumeValue> {
  sessionManager?: RunResumeSessionManager<TResumeValue>;
  pollIntervalMs?: number;
}

/** Public API contract for detached run tracker. */
export interface DetachedRunTracker<TResumeValue> {
  readonly sessionManager: RunResumeSessionManager<TResumeValue>;
  trackRun(runId: string): void;
  untrackRun(runId: string): void;
  cancelRun(runId: string): boolean;
  registerExecution(runId: string, execution: Promise<void>): void;
  cancelAllRuns(): string[];
  waitForDrain(
    input: { timeoutMs: number; pollIntervalMs?: number },
  ): Promise<DetachedRunDrainResult>;
  reset(): void;
}

/** Public API contract for detached run shutdown logger. */
export interface DetachedRunShutdownLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

/** Public API contract for detached run shutdown lifecycle. */
export interface DetachedRunShutdownLifecycle {
  setShuttingDown(): void;
  stop(): Promise<void>;
}

/** Options accepted by detached run shutdown lifecycle. */
export interface DetachedRunShutdownLifecycleOptions<TResumeValue> {
  tracker: DetachedRunTracker<TResumeValue>;
  logger: DetachedRunShutdownLogger;
  drainTimeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_DETACHED_RUN_DRAIN_TIMEOUT_MS = 15_000;
const DETACHED_RUN_DRAIN_TIMEOUT_MESSAGE =
  "Detached durable runs did not drain before shutdown timeout";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Create detached run tracker. */
export function createDetachedRunTracker<TResumeValue = unknown>(
  options: DetachedRunTrackerOptions<TResumeValue> = {},
): DetachedRunTracker<TResumeValue> {
  const sessionManager = options.sessionManager ?? new RunResumeSessionManager<TResumeValue>();
  const activeRunIds = new Set<string>();
  const activeExecutions = new Map<string, Promise<void>>();
  const defaultPollIntervalMs = options.pollIntervalMs ?? 50;

  const collectPendingRunIds = (): string[] => [
    ...new Set([...activeRunIds, ...activeExecutions.keys()]),
  ];

  const untrackRun = (runId: string): void => {
    activeRunIds.delete(runId);
  };

  return {
    sessionManager,
    trackRun(runId) {
      activeRunIds.add(runId);
    },
    untrackRun,
    cancelRun(runId) {
      const cancelled = sessionManager.cancelRun(runId);
      if (cancelled) {
        untrackRun(runId);
      }
      return cancelled;
    },
    registerExecution(runId, execution) {
      activeRunIds.add(runId);

      const trackedExecution = execution.finally(() => {
        if (activeExecutions.get(runId) !== trackedExecution) {
          return;
        }

        activeExecutions.delete(runId);
        untrackRun(runId);
      });

      activeExecutions.set(runId, trackedExecution);
    },
    cancelAllRuns() {
      const runIds = [...activeRunIds];
      for (const runId of runIds) {
        this.cancelRun(runId);
      }
      return runIds;
    },
    async waitForDrain(input) {
      const pollIntervalMs = input.pollIntervalMs ?? defaultPollIntervalMs;
      const deadline = Date.now() + input.timeoutMs;

      while (Date.now() <= deadline) {
        const pendingRunIds = collectPendingRunIds();
        if (pendingRunIds.length === 0) {
          return { drained: true, pendingRunIds: [] };
        }

        const executions = [...activeExecutions.values()];
        if (executions.length > 0) {
          await Promise.race([Promise.allSettled(executions), sleep(pollIntervalMs)]);
          continue;
        }

        await sleep(pollIntervalMs);
      }

      return {
        drained: false,
        pendingRunIds: collectPendingRunIds(),
      };
    },
    reset() {
      sessionManager.reset();
      activeRunIds.clear();
      activeExecutions.clear();
    },
  };
}

/** Create detached run shutdown lifecycle. */
export function createDetachedRunShutdownLifecycle<TResumeValue = unknown>(
  options: DetachedRunShutdownLifecycleOptions<TResumeValue>,
): DetachedRunShutdownLifecycle {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DETACHED_RUN_DRAIN_TIMEOUT_MS;

  return {
    setShuttingDown() {
      const cancelledRunIds = options.tracker.cancelAllRuns();
      if (cancelledRunIds.length === 0) {
        return;
      }

      options.logger.info("Cancelled active detached durable runs during shutdown", {
        runIds: cancelledRunIds,
        count: cancelledRunIds.length,
      });
    },
    async stop() {
      const drainResult = await options.tracker.waitForDrain({
        timeoutMs: drainTimeoutMs,
        pollIntervalMs: options.pollIntervalMs,
      });
      if (!drainResult.drained) {
        options.logger.error(DETACHED_RUN_DRAIN_TIMEOUT_MESSAGE, {
          pendingRunIds: drainResult.pendingRunIds,
          count: drainResult.pendingRunIds.length,
        });
        throw new Error(DETACHED_RUN_DRAIN_TIMEOUT_MESSAGE);
      }

      options.logger.info("All connections and detached durable runs drained, exiting");
    },
  };
}
