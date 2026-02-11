/**
 * Workflow Job Manager
 *
 * Orchestrates workflow execution via isolated jobs.
 * Uses pluggable JobExecutor interface for runtime flexibility.
 *
 * Supported runtimes:
 * - K8sJobExecutor: Kubernetes Jobs (production)
 * - ProcessJobExecutor: Child processes (local dev)
 * - DockerJobExecutor: Docker containers (future)
 *
 * Key properties:
 * - Each workflow runs in isolation (no shared state)
 * - Supports crash recovery via stalled job detection
 * - Runtime-agnostic through JobExecutor abstraction
 */

import { logger as baseLogger } from "#veryfront/utils";
import { hasLockSupport, hasWorkerSupport, type WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId } from "../types.ts";
import type { JobConfig, JobExecutor, JobStatus } from "./executors/types.ts";

const logger = baseLogger.component("workflow-job-manager");

// Re-export types for convenience
export type { JobExecutor, JobInfo, JobStatus } from "./executors/types.ts";

/**
 * Configuration for the Workflow Job Manager
 */
export interface WorkflowJobManagerConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

  /** Job executor (K8s, Docker, Process, etc.) */
  executor: JobExecutor;

  /** Environment variables to inject into jobs */
  env?: Record<string, string>;

  /** Poll interval for checking pending workflows (ms) */
  pollInterval?: number;

  /** Maximum concurrent jobs */
  maxConcurrentJobs?: number;

  /** Job timeout (ms) - kills job if it exceeds this */
  jobTimeout?: number;

  /** Time after which a run is considered stalled (ms) - for crash recovery */
  stalledThreshold?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Manager status
 */
export type ManagerStatus = "idle" | "running" | "stopping" | "stopped";

/**
 * Manager statistics
 */
export interface ManagerStats {
  status: ManagerStatus;
  managerId: string;
  startedAt?: Date;
  pollCount: number;
  jobsCreated: number;
  jobsCompleted: number;
  jobsFailed: number;
  activeJobs: number;
  lastPollAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
}

/**
 * Internal job tracking
 */
interface TrackedJob {
  jobId: string;
  runId: string;
  status: JobStatus;
  createdAt: Date;
}

/** Resolved config type with defaults applied */
type ResolvedConfig = Required<Omit<WorkflowJobManagerConfig, "env">> & {
  env?: Record<string, string>;
};

/**
 * Workflow Job Manager
 *
 * Orchestrates workflow execution via pluggable job executors.
 * Each workflow runs in complete isolation.
 *
 * @example K8s
 * ```typescript
 * const executor = new K8sJobExecutor({
 *   image: "my-app:latest",
 *   namespace: "workflows",
 * }, k8sClient);
 *
 * const manager = new WorkflowJobManager({
 *   backend: redisBackend,
 *   executor,
 * });
 *
 * manager.start();
 * ```
 *
 * @example Local Process
 * ```typescript
 * const executor = new ProcessJobExecutor({
 *   entrypointPath: "./job-entrypoint.ts",
 * });
 *
 * const manager = new WorkflowJobManager({
 *   backend: redisBackend,
 *   executor,
 * });
 *
 * manager.start();
 * ```
 */
export class WorkflowJobManager {
  private config: ResolvedConfig;
  private status: ManagerStatus = "idle";
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private activeJobs = new Map<string, TrackedJob>();
  private stats: ManagerStats;
  private managerId: string;

  constructor(config: WorkflowJobManagerConfig) {
    this.managerId = generateId("mgr");

    this.config = {
      pollInterval: 5000,
      maxConcurrentJobs: 10,
      jobTimeout: 30 * 60 * 1000, // 30 minutes
      stalledThreshold: 60000, // 60 seconds
      debug: false,
      ...config,
    };

    this.stats = {
      status: "idle",
      managerId: this.managerId,
      pollCount: 0,
      jobsCreated: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      activeJobs: 0,
    };
  }

  /**
   * Start the job manager
   */
  async start(): Promise<void> {
    if (this.status === "running") {
      throw new Error("Job manager is already running");
    }

    // Initialize executor if needed
    if (this.config.executor.initialize) {
      await this.config.executor.initialize();
    }

    this.status = "running";
    this.stats.status = "running";
    this.stats.startedAt = new Date();

    if (this.config.debug) {
      logger.info(`Started manager ${this.managerId}`);
    }

    // Start polling loop
    this.scheduleNextPoll();
  }

  /**
   * Stop the job manager gracefully
   */
  async stop(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.status = "stopping";
    this.stats.status = "stopping";

    if (this.config.debug) {
      logger.info(`Stopping manager ${this.managerId}...`);
    }

    // Clear scheduled poll
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }

    // Cleanup executor if needed
    if (this.config.executor.destroy) {
      await this.config.executor.destroy();
    }

    this.status = "stopped";
    this.stats.status = "stopped";

    if (this.config.debug) {
      logger.info(`Manager ${this.managerId} stopped`);
    }
  }

  /**
   * Get manager statistics
   */
  getStats(): ManagerStats {
    return { ...this.stats, activeJobs: this.activeJobs.size };
  }

  /**
   * Get active jobs
   */
  getActiveJobs(): TrackedJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Get manager ID
   */
  getManagerId(): string {
    return this.managerId;
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
   * Poll for pending workflows and manage jobs
   */
  private async poll(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      // 1. Check status of active jobs
      await this.syncJobStatuses();

      // 2. Find workflows that need execution
      const availableSlots = this.config.maxConcurrentJobs - this.activeJobs.size;
      if (availableSlots <= 0) {
        return;
      }

      // Get pending workflows from queue
      const pendingRuns = await this.config.backend.listRuns({
        status: "pending",
        limit: availableSlots,
      });

      // Also check for stalled workflows (crashed jobs)
      let stalledRuns: WorkflowRun[] = [];
      if (hasWorkerSupport(this.config.backend)) {
        stalledRuns = await this.config.backend.findStalledRuns(this.config.stalledThreshold);

        if (stalledRuns.length > 0 && this.config.debug) {
          logger.info(
            `[WorkflowJobManager] Found ${stalledRuns.length} stalled runs to recover`,
          );
        }
      }

      // Combine pending and stalled runs
      const runsToProcess = [...pendingRuns, ...stalledRuns].slice(0, availableSlots);

      for (const run of runsToProcess) {
        // Skip if already has an active job
        if (this.activeJobs.has(run.id)) {
          continue;
        }

        let pendingLockAcquired = false;
        let runToProcess: WorkflowRun | null = run;

        try {
          // For stalled runs, try to claim first
          if (run.status === "running" && hasWorkerSupport(this.config.backend)) {
            const claimed = await this.config.backend.claimStalledRun(
              run.id,
              `mgr:${this.managerId}`,
              this.config.stalledThreshold,
            );
            if (!claimed) {
              // Another manager claimed it
              continue;
            }
          }

          // For pending runs, acquire a short lock to avoid duplicate job creation
          // across managers between listRuns() and updateRun().
          if (run.status === "pending" && hasLockSupport(this.config.backend)) {
            pendingLockAcquired = await this.config.backend.acquireLock(
              run.id,
              this.config.stalledThreshold,
            );
            if (!pendingLockAcquired) {
              continue;
            }

            // Re-read after locking to ensure status hasn't changed concurrently.
            const latest = await this.config.backend.getRun(run.id);
            if (!latest || latest.status !== "pending") {
              continue;
            }
            runToProcess = latest;
          }

          if (!runToProcess) {
            continue;
          }

          await this.createJobForWorkflow(runToProcess);
        } finally {
          if (pendingLockAcquired) {
            try {
              await this.config.backend.releaseLock?.(run.id);
            } catch (error) {
              logger.warn(
                `[WorkflowJobManager] Failed to release pending lock for ${run.id}:`,
                error,
              );
            }
          }
        }
      }
    } catch (error) {
      this.recordError(error);
      logger.error(`Poll error:`, error);
    }
  }

  /**
   * Sync job statuses with executor
   */
  private async syncJobStatuses(): Promise<void> {
    try {
      const jobs = await this.config.executor.listJobs(this.managerId);

      for (const jobInfo of jobs) {
        const tracked = this.activeJobs.get(jobInfo.runId);
        if (!tracked) {
          continue;
        }

        if (jobInfo.status === tracked.status) {
          continue;
        }

        tracked.status = jobInfo.status;

        // Handle terminal states
        if (jobInfo.status === "succeeded" || jobInfo.status === "failed") {
          this.activeJobs.delete(jobInfo.runId);

          if (jobInfo.status === "succeeded") {
            this.stats.jobsCompleted++;
            if (this.config.debug) {
              logger.info(`Job completed: ${jobInfo.jobId}`);
            }
          } else {
            this.stats.jobsFailed++;
            logger.error(
              `[WorkflowJobManager] Job failed: ${jobInfo.jobId}`,
              jobInfo.error,
            );
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to sync job statuses:`, error);
    }
  }

  /**
   * Create a job for a workflow run
   */
  private async createJobForWorkflow(run: WorkflowRun): Promise<void> {
    const jobId = generateId("job");

    const jobConfig: JobConfig = {
      jobId,
      run,
      managerId: this.managerId,
      timeout: this.config.jobTimeout,
      env: this.config.env ?? {},
      debug: this.config.debug,
    };

    try {
      await this.config.executor.createJob(jobConfig);

      const tracked: TrackedJob = {
        jobId,
        runId: run.id,
        status: "pending",
        createdAt: new Date(),
      };

      this.activeJobs.set(run.id, tracked);
      this.stats.jobsCreated++;

      // Mark workflow as running
      await this.config.backend.updateRun(run.id, {
        status: "running",
        startedAt: new Date(),
        heartbeatAt: new Date(),
        workerId: `job:${jobId}`,
      });

      if (this.config.debug) {
        logger.info(`Created job ${jobId} for workflow ${run.id}`);
      }
    } catch (error) {
      logger.error(`Failed to create job for ${run.id}:`, error);

      // Mark workflow as failed
      await this.config.backend.updateRun(run.id, {
        status: "failed",
        error: {
          message: `JOB_CREATION_FAILED: Failed to create execution job: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
        completedAt: new Date(),
      });
    }
  }

  /**
   * Record an error in stats
   */
  private recordError(error: unknown): void {
    this.stats.lastErrorAt = new Date();
    this.stats.lastError = error instanceof Error ? error.message : String(error);
  }
}

/**
 * Create a workflow job manager
 */
export function createWorkflowJobManager(
  config: WorkflowJobManagerConfig,
): WorkflowJobManager {
  return new WorkflowJobManager(config);
}
