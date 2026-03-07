/**
 * Workflow Worker
 *
 * Polls for stalled workflow runs and resumes them.
 * Enables distributed workflow execution across multiple pods.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type { WorkflowBackend } from "../backends/types.ts";
import { hasWorkerSupport } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId } from "../types.ts";

const logger = baseLogger.component("workflow-worker");

/** Default interval between poll cycles */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Default threshold after which a run is considered stalled */
const DEFAULT_STALLED_THRESHOLD_MS = 60_000;

/**
 * Configuration for the workflow worker
 */
export interface WorkflowWorkerConfig {
  /** Backend for workflow persistence (must support worker features) */
  backend: WorkflowBackend;

  /** Function to resume a workflow run */
  resumeFn: (runId: string) => Promise<void>;

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
 *   resumeFn: (runId) => client.resume(runId),
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

export class WorkflowWorker {
  private config: ResolvedConfig;
  private status: WorkerStatus = "idle";
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private activeResumes = new Set<string>();
  private stats: WorkerStats;

  constructor(config: WorkflowWorkerConfig) {
    // Validate backend supports worker features
    if (!hasWorkerSupport(config.backend)) {
      throw new Error(
        "Backend does not support worker features. " +
          "Required methods: enqueue, dequeue, acknowledge, acquireLock, releaseLock, " +
          "findStalledRuns, claimStalledRun. " +
          "Use RedisBackend with worker support enabled.",
      );
    }

    this.config = {
      pollInterval: DEFAULT_POLL_INTERVAL_MS,
      stalledThreshold: DEFAULT_STALLED_THRESHOLD_MS,
      concurrency: 3,
      workerId: generateId("worker"),
      debug: false,
      ...config,
    };

    this.stats = {
      status: "idle",
      workerId: this.config.workerId,
      pollCount: 0,
      resumeCount: 0,
      errorCount: 0,
    };
  }

  /**
   * Start the worker polling loop
   */
  start(): void {
    if (this.status === "running") {
      throw new Error("Worker is already running");
    }

    this.status = "running";
    this.stats.status = "running";
    this.stats.startedAt = new Date();

    if (this.config.debug) {
      logger.info(`Started worker ${this.config.workerId}`);
    }

    // Start polling loop
    this.scheduleNextPoll();
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.status = "stopping";
    this.stats.status = "stopping";

    if (this.config.debug) {
      logger.info(`Stopping worker ${this.config.workerId}...`);
    }

    // Clear scheduled poll
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }

    // Wait for active resumes to complete
    while (this.activeResumes.size > 0) {
      if (this.config.debug) {
        logger.debug(
          `[WorkflowWorker] Waiting for ${this.activeResumes.size} active resumes to complete`,
        );
      }
      await this.sleep(1000);
    }

    this.status = "stopped";
    this.stats.status = "stopped";

    if (this.config.debug) {
      logger.info(`Worker ${this.config.workerId} stopped`);
    }
  }

  /**
   * Get worker statistics
   */
  getStats(): WorkerStats {
    return { ...this.stats };
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
  private scheduleNextPoll(): void {
    if (this.status !== "running") {
      return;
    }

    this.pollTimeout = setTimeout(async () => {
      await this.poll();
      this.scheduleNextPoll();
    }, this.config.pollInterval);
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
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      // Backend is validated in constructor to have worker support
      const { findStalledRuns, claimStalledRun } = this.config.backend;

      // Find stalled runs
      const stalledRuns = await findStalledRuns!(this.config.stalledThreshold);

      if (stalledRuns.length === 0) {
        return;
      }

      if (this.config.debug) {
        logger.info(`Found ${stalledRuns.length} stalled runs`);
      }

      // Try to claim and resume stalled runs (up to concurrency limit)
      const availableSlots = this.config.concurrency - this.activeResumes.size;

      for (const run of stalledRuns.slice(0, availableSlots)) {
        // Skip if already being resumed by this worker
        if (this.activeResumes.has(run.id)) {
          continue;
        }

        // Try to claim the run
        const claimed = await claimStalledRun!(
          run.id,
          this.config.workerId,
          this.config.stalledThreshold,
        );

        if (claimed) {
          this.resumeInBackground(run);
        }
      }
    } catch (error) {
      this.recordError(error);
      logger.error(`Poll error:`, error);
    }
  }

  /**
   * Resume a workflow in the background
   */
  private resumeInBackground(run: WorkflowRun): void {
    this.activeResumes.add(run.id);

    (async () => {
      try {
        if (this.config.debug) {
          logger.info(`Resuming stalled run ${run.id}`);
        }

        await this.config.resumeFn(run.id);

        this.stats.resumeCount++;

        if (this.config.debug) {
          logger.info(`Successfully resumed run ${run.id}`);
        }
      } catch (error) {
        this.recordError(error);
        logger.error(`Failed to resume run ${run.id}:`, error);
      } finally {
        this.activeResumes.delete(run.id);
      }
    })();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create a workflow worker
 */
export function createWorkflowWorker(config: WorkflowWorkerConfig): WorkflowWorker {
  return new WorkflowWorker(config);
}
