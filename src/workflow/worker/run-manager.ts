/**
 * Workflow run manager
 *
 * Orchestrates workflow run execution via isolated run executors.
 * Uses pluggable RunExecutor interface for runtime flexibility.
 *
 * Supported runtime:
 * - ProcessRunExecutor: Child processes for local development and trusted hosts
 *
 * Key properties:
 * - Each workflow runs in isolation (no shared state)
 * - Supports crash recovery via stalled execution detection
 * - Runtime-agnostic through RunExecutor abstraction
 */

import { logger as baseLogger } from "#veryfront/utils";
import { hasWorkerSupport, type WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId } from "../types.ts";
import type { RunExecutionStatus, RunExecutor } from "./executors/types.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { claimWorkflowRunControl } from "../runtime/workflow-run-control.ts";

const logger = baseLogger.component("workflow-run-manager");

/** Default interval between poll cycles */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Default timeout for a single run execution (30 minutes) */
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;

/** Default threshold after which a run is considered stalled */
const DEFAULT_STALLED_THRESHOLD_MS = 60_000;

// Re-export types for convenience
export type { RunExecutionInfo, RunExecutionStatus, RunExecutor } from "./executors/types.ts";

/**
 * Configuration for the workflow run manager backed by run executors.
 */
export interface WorkflowRunManagerConfig {
  /** Backend for workflow persistence */
  backend: WorkflowBackend;

  /** Run executor used to start isolated workflow processes */
  executor: RunExecutor;

  /** Environment variables to inject into run executions */
  env?: Record<string, string>;

  /** Poll interval for checking pending workflows (ms) */
  pollInterval?: number;

  /** Maximum concurrent run executions */
  maxConcurrentExecutions?: number;

  /** Run timeout (ms) - kills execution if it exceeds this */
  executionTimeout?: number;

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
  executionsCreated: number;
  executionsCompleted: number;
  executionsFailed: number;
  activeExecutions: number;
  lastPollAt?: Date;
  lastErrorAt?: Date;
  lastError?: string;
}

/**
 * Internal run execution tracking
 */
interface TrackedExecution {
  executionId: string;
  runId: string;
  status: RunExecutionStatus;
  createdAt: Date;
  /** Consecutive sync cycles this execution was absent from the executor's list. */
  missingPolls: number;
}

/** Resolved config type with defaults applied */
type ResolvedConfig = Required<Omit<WorkflowRunManagerConfig, "env">> & {
  env?: Record<string, string>;
};

/**
 * Workflow run manager
 *
 * Orchestrates workflow execution via pluggable run executors.
 * Each workflow runs in complete isolation.
 *
 * @example Local Process
 * ```typescript
 * const executor = new ProcessRunExecutor({
 *   entrypointPath: "./workflow-run.ts",
 * });
 *
 * const manager = new WorkflowRunManager({
 *   backend: redisBackend,
 *   executor,
 * });
 *
 * manager.start();
 * ```
 */
export class WorkflowRunManager {
  private config: ResolvedConfig;
  private status: ManagerStatus = "idle";
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private activeExecutions = new Map<string, TrackedExecution>();
  private stats: ManagerStats;
  private managerId: string;

  constructor(config: WorkflowRunManagerConfig) {
    this.managerId = generateId("mgr");

    this.config = {
      pollInterval: DEFAULT_POLL_INTERVAL_MS,
      maxConcurrentExecutions: 10,
      executionTimeout: DEFAULT_EXECUTION_TIMEOUT_MS,
      stalledThreshold: DEFAULT_STALLED_THRESHOLD_MS,
      debug: false,
      ...config,
    };

    this.stats = {
      status: "idle",
      managerId: this.managerId,
      pollCount: 0,
      executionsCreated: 0,
      executionsCompleted: 0,
      executionsFailed: 0,
      activeExecutions: 0,
    };
  }

  /**
   * Start the workflow run manager.
   */
  async start(): Promise<void> {
    if (this.status === "running") {
      throw ORCHESTRATION_ERROR.create({ detail: "Workflow run manager is already running" });
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
   * Stop the workflow run manager gracefully.
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
    return { ...this.stats, activeExecutions: this.activeExecutions.size };
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): TrackedExecution[] {
    return Array.from(this.activeExecutions.values());
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
      // poll() guards itself, but reschedule from a finally so an unexpected
      // rejection can never kill the loop (leaving the manager alive-but-idle).
      try {
        await this.poll();
      } catch (error) {
        this.recordError(error);
        logger.error("Unhandled poll error:", error);
      } finally {
        this.scheduleNextPoll();
      }
    }, this.config.pollInterval);
  }

  /**
   * Poll for pending workflows and manage run executions
   */
  private async poll(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      // 1. Check status of active executions
      await this.syncRunExecutionStatuses();

      // 2. Find workflows that need execution
      const availableSlots = this.config.maxConcurrentExecutions - this.activeExecutions.size;
      if (availableSlots <= 0) {
        return;
      }

      // Get pending workflows from queue
      const pendingRuns = await this.config.backend.listRuns({
        status: "pending",
        limit: availableSlots,
      });

      // Also check for stalled workflows (crashed run executions)
      let stalledRuns: WorkflowRun[] = [];
      if (hasWorkerSupport(this.config.backend)) {
        stalledRuns = await this.config.backend.findStalledRuns(this.config.stalledThreshold);

        if (stalledRuns.length > 0 && this.config.debug) {
          logger.info(
            `[WorkflowRunManager] Found ${stalledRuns.length} stalled runs to recover`,
          );
        }
      }

      // Combine pending and stalled runs
      const runsToProcess = [...pendingRuns, ...stalledRuns].slice(0, availableSlots);

      for (const run of runsToProcess) {
        // Skip if already has an active execution
        if (this.activeExecutions.has(run.id)) {
          continue;
        }

        await this.createExecutionForWorkflow(run);
      }
    } catch (error) {
      this.recordError(error);
      logger.error(`Poll error:`, error);
    }
  }

  /**
   * Sync run execution statuses with executor
   */
  private async syncRunExecutionStatuses(): Promise<void> {
    try {
      const executions = await this.config.executor.listRunExecutions(this.managerId);
      const presentRunIds = new Set(executions.map((e) => e.runId));

      // Reconcile against the executor's live list. A child process reaped or
      // OOM-killed before reporting a terminal status would otherwise stay in
      // activeExecutions forever, permanently consuming a concurrency slot.
      // Require two consecutive misses before reclaiming to avoid races with an
      // execution not yet visible in the executor's list.
      for (const [runId, tracked] of this.activeExecutions) {
        if (presentRunIds.has(runId)) {
          tracked.missingPolls = 0;
          continue;
        }

        tracked.missingPolls++;
        if (tracked.missingPolls >= 2) {
          this.activeExecutions.delete(runId);
          this.stats.executionsFailed++;
          logger.warn("[WorkflowRunManager] Run execution vanished; freeing concurrency slot");
        }
      }

      for (const executionInfo of executions) {
        const tracked = this.activeExecutions.get(executionInfo.runId);
        if (!tracked) {
          continue;
        }

        // Handle terminal states
        if (executionInfo.status === "succeeded" || executionInfo.status === "failed") {
          try {
            await this.config.executor.deleteRunExecution(executionInfo.executionId);
          } catch (error) {
            tracked.status = executionInfo.status;
            logger.warn(
              `[WorkflowRunManager] Failed to clean up run execution ${executionInfo.executionId}:`,
              error,
            );
            continue;
          }

          this.activeExecutions.delete(executionInfo.runId);

          if (executionInfo.status === "succeeded") {
            this.stats.executionsCompleted++;
            if (this.config.debug) {
              logger.info(`Run execution completed: ${executionInfo.executionId}`);
            }
          } else {
            this.stats.executionsFailed++;
            logger.error(
              `[WorkflowRunManager] Run execution failed: ${executionInfo.executionId}`,
              executionInfo.error,
            );
          }
          continue;
        }

        if (executionInfo.status === tracked.status) {
          continue;
        }

        tracked.status = executionInfo.status;
      }
    } catch (error) {
      logger.error(`Failed to sync run execution statuses:`, error);
    }
  }

  /**
   * Create an isolated execution for a workflow run
   */
  private async createExecutionForWorkflow(run: WorkflowRun): Promise<void> {
    const executionId = generateId("run_exec");
    const outcome = await claimWorkflowRunControl({
      backend: this.config.backend,
      run,
      managerId: this.managerId,
      executionId,
      stalledThreshold: this.config.stalledThreshold,
      executionTimeout: this.config.executionTimeout,
      env: this.config.env ?? {},
      debug: this.config.debug,
      createRunExecution: (config) => this.config.executor.createRunExecution(config),
    });

    if (outcome.status === "created" && outcome.execution) {
      const tracked: TrackedExecution = {
        executionId: outcome.execution.executionId,
        runId: outcome.execution.runId,
        status: outcome.execution.status,
        createdAt: outcome.execution.createdAt,
        missingPolls: 0,
      };

      this.activeExecutions.set(run.id, tracked);
      this.stats.executionsCreated++;

      if (this.config.debug) {
        logger.info(`Created run execution ${executionId} for workflow ${run.id}`);
      }
      return;
    }

    if (outcome.status === "failed-before-claim" || outcome.status === "failed-after-claim") {
      this.stats.executionsFailed++;
      logger.error(`Failed to create run execution for ${run.id}:`, outcome.error);
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
 * Create a workflow run manager backed by run executors.
 */
export function createWorkflowRunManager(
  config: WorkflowRunManagerConfig,
): WorkflowRunManager {
  return new WorkflowRunManager(config);
}
