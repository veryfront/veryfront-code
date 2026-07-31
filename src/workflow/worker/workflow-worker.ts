/**
 * Workflow Worker
 *
 * Polls for stalled workflow runs and resumes them.
 * Enables distributed workflow execution across multiple pods.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type { WorkflowBackend } from "../backends/types.ts";
import { assertWorkflowWorkerId, hasWorkerSupport, updateRunIfStatus } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId, parsePositiveDurationWithLabel } from "../types.ts";
import { CONFIG_INVALID, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { runWithWorkflowSourceIntegrationPolicy } from "../source-integration-policy.ts";
import { validatePositiveSafeInteger } from "../dsl/validation.ts";
import { TimedWaitRecoveryService } from "../runtime/timed-wait-recovery.ts";

const logger = baseLogger.component("workflow-worker");

/** Default interval between poll cycles */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Default threshold after which a run is considered stalled */
const DEFAULT_STALLED_THRESHOLD_MS = 60_000;

/** Maximum time stop() waits before rejecting while remaining in `stopping` */
const WORKER_STOP_TIMEOUT_MS = 30_000;

/**
 * Configuration for the workflow worker
 */
export interface WorkflowWorkerConfig {
  /** Backend for workflow persistence (must support worker features) */
  backend: WorkflowBackend;

  /** Function to resume a workflow run under the worker that claimed it */
  resumeFn: (runId: string, expectedWorkerId?: string) => Promise<void>;

  /** Interval between poll cycles (ms) */
  pollInterval?: number;

  /** Time after which a run is considered stalled (ms) */
  stalledThreshold?: number;

  /** Maximum concurrent workflow resumes */
  concurrency?: number;

  /** Unique identifier for this worker instance */
  workerId?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Worker status
 */
export type WorkerStatus = "idle" | "running" | "stopping" | "stopped";

/**
 * Worker statistics
 */
export interface WorkerStats {
  status: WorkerStatus;
  workerId: string;
  startedAt?: Date;
  pollCount: number;
  resumeCount: number;
  errorCount: number;
  lastPollAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
}

/**
 * Workflow Worker class
 *
 * Polls for stalled workflow runs and resumes them, enabling automatic
 * recovery from crashes and distributed execution.
 *
 * @example
 * ```typescript
 * const worker = new WorkflowWorker({
 *   backend: redisBackend,
 *   resumeFn: (runId, expectedWorkerId) => client.resume(runId, expectedWorkerId),
 *   pollInterval: 5000,
 *   stalledThreshold: 60000,
 * });
 *
 * worker.start();
 *
 * // Later, to stop gracefully:
 * await worker.stop();
 * ```
 */
/** Keys that remain optional even after defaults are applied */
type OptionalConfigKeys = "backend" | "resumeFn";

/** Resolved config type with defaults applied */
type ResolvedConfig =
  & Required<Omit<WorkflowWorkerConfig, OptionalConfigKeys>>
  & Pick<WorkflowWorkerConfig, OptionalConfigKeys>;

/** Implement workflow worker. */
export class WorkflowWorker {
  private config: ResolvedConfig;
  private status: WorkerStatus = "idle";
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private pollPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private lifecycleGeneration = 0;
  private activeResumes = new Map<string, Promise<void>>();
  private pendingClaimRequeues = new Set<string>();
  private claimRequeuePromises = new Map<string, Promise<void>>();
  private stats: WorkerStats;
  private timedWaitRecovery: TimedWaitRecoveryService;

  constructor(config: WorkflowWorkerConfig) {
    // Validate backend supports worker features
    if (!hasWorkerSupport(config.backend)) {
      throw CONFIG_INVALID.create({
        detail: "Backend does not support worker features. " +
          "Required methods: enqueue, dequeue, acknowledge, acquireLock, extendLock, releaseLock, " +
          "updateRunIfStatusAndLock, findStalledRuns, claimStalledRun, updateRunIfStatusAndWorker, " +
          "saveCheckpointIfStatusAndWorker, savePendingApprovalIfStatusAndWorker. " +
          "Use a distributed workflow backend with worker support enabled.",
      });
    }

    const pollInterval = parsePositiveDurationWithLabel(
      config.pollInterval ?? DEFAULT_POLL_INTERVAL_MS,
      "WorkflowWorker pollInterval",
    );
    const stalledThreshold = parsePositiveDurationWithLabel(
      config.stalledThreshold ?? DEFAULT_STALLED_THRESHOLD_MS,
      "WorkflowWorker stalledThreshold",
    );
    const concurrency = config.concurrency ?? 3;
    validatePositiveSafeInteger(concurrency, "WorkflowWorker concurrency");
    const workerId = config.workerId ?? generateId("worker");
    assertWorkflowWorkerId(workerId);
    if (typeof config.resumeFn !== "function") {
      throw CONFIG_INVALID.create({ detail: "WorkflowWorker resumeFn must be a function" });
    }

    this.config = {
      ...config,
      pollInterval,
      stalledThreshold,
      concurrency,
      workerId,
      debug: config.debug ?? false,
    };

    this.stats = {
      status: "idle",
      workerId: this.config.workerId,
      pollCount: 0,
      resumeCount: 0,
      errorCount: 0,
    };
    this.timedWaitRecovery = new TimedWaitRecoveryService(
      config.backend,
      `${workerId}:timed-waits`,
    );
  }

  /**
   * Start the worker polling loop
   */
  start(): void {
    if (
      this.status === "running" ||
      this.status === "stopping" ||
      this.stopPromise !== undefined
    ) {
      throw ORCHESTRATION_ERROR.create({
        detail: this.status === "running"
          ? "Worker is already running"
          : "Worker cannot start while shutdown is in progress",
      });
    }

    this.status = "running";
    this.stats.status = "running";
    this.stats.startedAt = new Date();
    const lifecycleGeneration = ++this.lifecycleGeneration;

    if (this.config.debug) {
      logger.info(`Started worker ${this.config.workerId}`);
    }

    // Start polling loop
    this.scheduleNextPoll(lifecycleGeneration);
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    if (this.stopPromise) return await this.stopPromise;
    if (this.status === "idle" || this.status === "stopped") return;

    if (this.status === "running") {
      this.status = "stopping";
      this.stats.status = "stopping";
      // Invalidate every completion callback captured by this lifecycle. A
      // stale poll must not schedule an extra timer after a later restart.
      this.lifecycleGeneration++;

      if (this.config.debug) {
        logger.info(`Stopping worker ${this.config.workerId}...`);
      }
    }

    const stopAttempt = (async () => {
      // Clear scheduled poll
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
        this.pollTimeout = undefined;
      }

      const stopDeadline = Date.now() + WORKER_STOP_TIMEOUT_MS;

      // A timer may already have started a poll before it could be cleared.
      // Join that poll first so it cannot admit work after shutdown completes.
      const inFlightPoll = this.pollPromise;
      if (inFlightPoll) {
        await this.waitForShutdownWork(inFlightPoll, stopDeadline);
      }

      // A claim that completed after admission closed is requeued under the
      // exact owner CAS. Retain failed compensations across stop retries.
      for (const runId of [...this.pendingClaimRequeues]) {
        await this.waitForShutdownWork(
          this.requeueClaimAfterAdmissionClosed(runId),
          stopDeadline,
        );
      }

      // poll() can only add resumes before it settles. Since it is joined
      // above, the active set is now stable apart from completions.
      while (this.activeResumes.size > 0) {
        if (this.config.debug) {
          logger.debug(
            `[WorkflowWorker] Waiting for ${this.activeResumes.size} active resumes to complete`,
          );
        }
        await this.waitForShutdownWork(
          Promise.allSettled([...this.activeResumes.values()]).then(() => undefined),
          stopDeadline,
        );
      }

      this.status = "stopped";
      this.stats.status = "stopped";

      if (this.config.debug) {
        logger.info(`Worker ${this.config.workerId} stopped`);
      }
    })();
    const trackedAttempt = stopAttempt.finally(() => {
      if (this.stopPromise === trackedAttempt) this.stopPromise = undefined;
    });
    this.stopPromise = trackedAttempt;
    return await trackedAttempt;
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return structuredClone(this.stats);
  }

  /**
   * Get worker ID
   */
  getWorkerId(): string {
    return this.config.workerId;
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(lifecycleGeneration: number): void {
    if (
      this.status !== "running" ||
      lifecycleGeneration !== this.lifecycleGeneration
    ) {
      return;
    }

    const timeout = setTimeout(() => {
      if (this.pollTimeout === timeout) this.pollTimeout = undefined;
      if (
        this.status !== "running" ||
        lifecycleGeneration !== this.lifecycleGeneration
      ) {
        return;
      }
      void this.poll().then(
        () => this.scheduleNextPoll(lifecycleGeneration),
        (error) => {
          logger.error("Unhandled poll error:", error);
          this.scheduleNextPoll(lifecycleGeneration);
        },
      );
    }, this.config.pollInterval);
    this.pollTimeout = timeout;
  }

  /**
   * Await shutdown work without ever claiming the worker is stopped while it
   * is still live. A timed-out stop remains retryably `stopping`.
   */
  private async waitForShutdownWork(work: Promise<unknown>, deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw this.createStopTimeoutError();

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(this.createStopTimeoutError());
          }, remaining);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  /** Create the truthful timeout used by every stop wait. */
  private createStopTimeoutError(): Error {
    return ORCHESTRATION_ERROR.create({
      detail: `Workflow worker ${this.config.workerId} stop timed out; ` +
        `${this.activeResumes.size} resume(s), ${this.pendingClaimRequeues.size} claim requeue(s), ` +
        `and ${this.pollPromise ? "an" : "no"} in-flight poll remain. ` +
        "The worker is still stopping.",
    });
  }

  /**
   * Record an error in stats
   */
  private recordError(error: unknown): void {
    this.stats.errorCount++;
    this.stats.lastErrorAt = new Date();
    this.stats.lastError = error instanceof Error ? error.message : String(error);
  }

  /**
   * Poll for stalled workflows and resume them
   */
  private async poll(): Promise<void> {
    if (this.pollPromise) return await this.pollPromise;

    const pollAttempt = this.pollOperation();
    const trackedAttempt = pollAttempt.finally(() => {
      if (this.pollPromise === trackedAttempt) this.pollPromise = undefined;
    });
    this.pollPromise = trackedAttempt;
    return await trackedAttempt;
  }

  /** Execute one poll cycle. */
  private async pollOperation(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      const initialSlots = this.config.concurrency - this.activeResumes.size;
      const recovered = await this.timedWaitRecovery.recover({
        now: Date.now(),
        maxAwakened: Math.max(0, initialSlots),
        nextWorkerId: this.config.workerId,
      });
      for (const { error, runId } of recovered.errors) {
        this.recordError(error);
        logger.error(
          runId
            ? `Failed to reconcile timed wait for workflow run ${runId}:`
            : "Failed to reconcile timed workflow waits:",
          error,
        );
      }
      if (this.status !== "running") return;
      for (const run of recovered.awakenedRuns) {
        if (this.status !== "running") return;
        this.resumeInBackground(run);
      }

      // Find stalled runs
      const stalledRuns = await this.config.backend.findStalledRuns!(
        this.config.stalledThreshold,
      );

      if (this.status !== "running") return;

      if (stalledRuns.length === 0) return;

      if (this.config.debug) {
        logger.info(`Found ${stalledRuns.length} stalled runs`);
      }

      // Try to claim and resume stalled runs (up to concurrency limit)
      const availableSlots = this.config.concurrency - this.activeResumes.size;
      if (availableSlots <= 0) return;

      for (const run of stalledRuns.slice(0, availableSlots)) {
        if (this.status !== "running") return;

        // Skip if already being resumed by this worker
        if (this.activeResumes.has(run.id)) {
          continue;
        }

        // Try to claim the run
        const claimed = await this.config.backend.claimStalledRun!(
          run.id,
          this.config.workerId,
          this.config.stalledThreshold,
        );

        if (this.status !== "running") {
          if (claimed) {
            this.pendingClaimRequeues.add(run.id);
            await this.requeueClaimAfterAdmissionClosed(run.id);
          }
          return;
        }

        if (claimed) {
          this.resumeInBackground(run);
        }
      }
    } catch (error) {
      this.recordError(error);
      logger.error(`Poll error:`, error);
      // During shutdown, compensation failures must fail stop() rather than
      // letting the worker report stopped with a run it still durably owns.
      if (this.status !== "running" && this.pendingClaimRequeues.size > 0) {
        throw error;
      }
    }
  }

  /**
   * Return a run claimed after admission closed to pending under an exact
   * owner comparison. Replacement and terminal states are never overwritten.
   */
  private requeueClaimAfterAdmissionClosed(runId: string): Promise<void> {
    const existing = this.claimRequeuePromises.get(runId);
    if (existing) return existing;

    const requeueAttempt = this.requeueClaimAfterAdmissionClosedOperation(runId);
    const trackedAttempt = requeueAttempt.finally(() => {
      if (this.claimRequeuePromises.get(runId) === trackedAttempt) {
        this.claimRequeuePromises.delete(runId);
      }
    });
    this.claimRequeuePromises.set(runId, trackedAttempt);
    return trackedAttempt;
  }

  /** Execute one owner-fenced shutdown compensation. */
  private async requeueClaimAfterAdmissionClosedOperation(runId: string): Promise<void> {
    const requeued = await updateRunIfStatus(
      this.config.backend,
      runId,
      ["running"],
      { status: "pending" },
      this.config.workerId,
    );
    if (requeued) {
      this.pendingClaimRequeues.delete(runId);
      return;
    }

    const latest = await this.config.backend.getRun(runId);
    if (
      !latest ||
      latest.status !== "running" ||
      latest.workerId !== this.config.workerId
    ) {
      this.pendingClaimRequeues.delete(runId);
      return;
    }

    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow worker ${this.config.workerId} could not requeue claimed run ${runId} ` +
        "during shutdown; the same worker still owns the running run.",
    });
  }

  /**
   * Resume a workflow in the background
   */
  private resumeInBackground(run: WorkflowRun): void {
    if (this.activeResumes.has(run.id)) return;

    const resumeAttempt = (async () => {
      try {
        if (this.config.debug) {
          logger.info(`Resuming stalled run ${run.id}`);
        }

        await runWithWorkflowSourceIntegrationPolicy(
          run,
          () => this.config.resumeFn(run.id, this.config.workerId),
        );

        this.stats.resumeCount++;

        if (this.config.debug) {
          logger.info(`Successfully resumed run ${run.id}`);
        }
      } catch (error) {
        this.recordError(error);
        logger.error(`Failed to resume run ${run.id}:`, error);
      }
    })();
    // Remove through the tracked promise so an older completion can never
    // delete a newer resume of the same run.
    const trackedAttempt = resumeAttempt.finally(() => {
      if (this.activeResumes.get(run.id) === trackedAttempt) {
        this.activeResumes.delete(run.id);
      }
    });
    this.activeResumes.set(run.id, trackedAttempt);
  }
}

/**
 * Create a workflow worker
 */
export function createWorkflowWorker(config: WorkflowWorkerConfig): WorkflowWorker {
  return new WorkflowWorker(config);
}
