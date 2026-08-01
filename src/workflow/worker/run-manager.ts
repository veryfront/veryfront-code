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
import { hasWorkerSupport, updateRunIfStatus, type WorkflowBackend } from "../backends/types.ts";
import type { WorkflowRun } from "../types.ts";
import { generateId, parsePositiveDurationWithLabel } from "../types.ts";
import type { RunExecutionStatus, RunExecutor } from "./executors/types.ts";
import { CONFIG_INVALID, ensureError, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { claimWorkflowRunControl } from "../runtime/workflow-run-control.ts";
import { validatePositiveSafeInteger } from "../dsl/validation.ts";
import { TimedWaitRecoveryService } from "../runtime/timed-wait-recovery.ts";
import { MAX_WORKFLOW_RUN_LIST_LIMIT } from "../limits.ts";

const logger = baseLogger.component("workflow-run-manager");

/** Default interval between poll cycles */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/** Default timeout for a single run execution (30 minutes) */
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;

/** Default threshold after which a run is considered stalled */
const DEFAULT_STALLED_THRESHOLD_MS = 60_000;

/** Default child polling interval while the manager releases its claim lease. */
const DEFAULT_LOCK_RETRY_INTERVAL_MS = 50;

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

  /** Child lock polling interval during manager-to-execution handoff (ms) */
  lockRetryInterval?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Manager status
 */
export type ManagerStatus = "idle" | "starting" | "running" | "stopping" | "stopped";

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
  pendingCleanupExecutions: number;
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

interface TeardownCandidate {
  executionId: string;
  runId: string;
  /** Original claim failure retained across cleanup retries. */
  initialError?: Error;
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
  private pollPromise?: Promise<void>;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private executorDestroyPromise?: Promise<void>;
  private executorDestroyed = false;
  private activeExecutions = new Map<string, TrackedExecution>();
  private teardownCandidates = new Map<string, TeardownCandidate>();
  private stats: ManagerStats;
  private managerId: string;
  private timedWaitRecovery: TimedWaitRecoveryService;

  constructor(config: WorkflowRunManagerConfig) {
    if (!hasWorkerSupport(config.backend)) {
      throw CONFIG_INVALID.create({
        detail: "Backend does not support managed workflow execution. " +
          "Required methods: enqueue, dequeue, acknowledge, acquireLock, extendLock, releaseLock, " +
          "updateRunIfStatusAndLock, findStalledRuns, claimStalledRun, updateRunIfStatusAndWorker, " +
          "saveCheckpointIfStatusAndWorker, savePendingApprovalIfStatusAndWorker, " +
          "claimDueTimedWaits, updateRunIfTimedWaitClaim, releaseTimedWaitClaim.",
      });
    }
    this.managerId = generateId("mgr");
    this.timedWaitRecovery = new TimedWaitRecoveryService(
      config.backend,
      `${this.managerId}:timed-waits`,
    );

    const pollInterval = parsePositiveDurationWithLabel(
      config.pollInterval ?? DEFAULT_POLL_INTERVAL_MS,
      "WorkflowRunManager pollInterval",
    );
    const executionTimeout = parsePositiveDurationWithLabel(
      config.executionTimeout ?? DEFAULT_EXECUTION_TIMEOUT_MS,
      "WorkflowRunManager executionTimeout",
    );
    const stalledThreshold = parsePositiveDurationWithLabel(
      config.stalledThreshold ?? DEFAULT_STALLED_THRESHOLD_MS,
      "WorkflowRunManager stalledThreshold",
    );
    if (stalledThreshold < 3) {
      throw CONFIG_INVALID.create({
        detail: "WorkflowRunManager stalledThreshold must be at least 3 milliseconds",
      });
    }
    const lockRetryInterval = parsePositiveDurationWithLabel(
      config.lockRetryInterval ?? DEFAULT_LOCK_RETRY_INTERVAL_MS,
      "WorkflowRunManager lockRetryInterval",
    );
    const maxConcurrentExecutions = config.maxConcurrentExecutions ?? 10;
    validatePositiveSafeInteger(
      maxConcurrentExecutions,
      "WorkflowRunManager maxConcurrentExecutions",
    );

    this.config = {
      ...config,
      pollInterval,
      maxConcurrentExecutions,
      executionTimeout,
      stalledThreshold,
      lockRetryInterval,
      env: config.env === undefined ? undefined : { ...config.env },
      debug: config.debug ?? false,
    };

    this.stats = {
      status: "idle",
      managerId: this.managerId,
      pollCount: 0,
      executionsCreated: 0,
      executionsCompleted: 0,
      executionsFailed: 0,
      activeExecutions: 0,
      pendingCleanupExecutions: 0,
    };
  }

  /**
   * Start the workflow run manager.
   */
  async start(): Promise<void> {
    if (this.status === "starting" && this.startPromise) await this.startPromise;
    else if (this.status === "starting") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow run manager startup state is inconsistent",
      });
    } else if (
      this.status === "running" || this.status === "stopping" || this.status === "stopped"
    ) {
      throw ORCHESTRATION_ERROR.create({
        detail: this.status === "running"
          ? "Workflow run manager is already running"
          : this.status === "stopped"
          ? "Workflow run manager cannot restart after its executor has been destroyed"
          : "Workflow run manager cannot start while shutdown is in progress",
      });
    } else {
      this.status = "starting";
      this.stats.status = "starting";
      const startAttempt = (async () => {
        try {
          await this.config.executor.initialize?.();
          if (this.status !== "starting") return;

          this.status = "running";
          this.stats.status = "running";
          this.stats.startedAt = new Date();

          if (this.config.debug) logger.info(`Started manager ${this.managerId}`);
          this.scheduleNextPoll();
        } catch (error) {
          if (this.status === "starting") {
            // Initialization is not required to be transactional. A partially
            // initialized executor must be torn down and made terminal before
            // the failed start can return.
            this.status = "stopping";
            this.stats.status = "stopping";
            try {
              await this.destroyExecutor();
              this.status = "stopped";
              this.stats.status = "stopped";
            } catch (cleanupError) {
              throw ORCHESTRATION_ERROR.create({
                detail: "Workflow run manager initialization and executor cleanup both failed",
                cause: new AggregateError([error, cleanupError]),
              });
            }
          }
          throw error;
        }
      })();
      const trackedAttempt = startAttempt.finally(() => {
        if (this.startPromise === trackedAttempt) this.startPromise = undefined;
      });
      this.startPromise = trackedAttempt;
      await trackedAttempt;
    }
  }

  /**
   * Stop the workflow run manager gracefully.
   */
  async stop(): Promise<void> {
    if (this.status === "idle" || this.status === "stopped") return;
    if (this.stopPromise) return await this.stopPromise;

    if (this.status === "starting" || this.status === "running") {
      this.status = "stopping";
      this.stats.status = "stopping";

      if (this.config.debug) {
        logger.info(`Stopping manager ${this.managerId}...`);
      }
    }

    const stopAttempt = (async () => {
      // Clear the poll timer before executor cleanup. If cleanup fails, the
      // manager remains in "stopping" and a later explicit stop() retries only
      // the resource teardown without ever restarting polling.
      if (this.pollTimeout) {
        clearTimeout(this.pollTimeout);
        this.pollTimeout = undefined;
      }

      if (this.startPromise) {
        await this.startPromise.catch((error) => {
          logger.warn("Workflow run manager initialization failed during shutdown", error);
        });
      }

      if (this.pollPromise) await this.pollPromise;

      await this.destroyExecutor();
      await this.requeueStoppedExecutions();

      this.status = "stopped";
      this.stats.status = "stopped";

      if (this.config.debug) {
        logger.info(`Manager ${this.managerId} stopped`);
      }
    })();
    const trackedAttempt = stopAttempt.finally(() => {
      if (this.stopPromise === trackedAttempt) this.stopPromise = undefined;
    });
    this.stopPromise = trackedAttempt;
    return await trackedAttempt;
  }

  /**
   * Get manager statistics
   */
  getStats(): ManagerStats {
    return structuredClone({
      ...this.stats,
      activeExecutions: this.activeExecutions.size,
      pendingCleanupExecutions: this.teardownCandidates.size,
    });
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): TrackedExecution[] {
    return structuredClone(Array.from(this.activeExecutions.values()));
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
      this.pollTimeout = undefined;
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
  private poll(): Promise<void> {
    if (this.pollPromise) return this.pollPromise;
    const pollAttempt = this.pollOperation();
    const trackedAttempt = pollAttempt.finally(() => {
      if (this.pollPromise === trackedAttempt) this.pollPromise = undefined;
    });
    this.pollPromise = trackedAttempt;
    return trackedAttempt;
  }

  private async pollOperation(): Promise<void> {
    if (this.status !== "running") {
      return;
    }

    this.stats.pollCount++;
    this.stats.lastPollAt = new Date();

    try {
      // 1. Check status of active executions
      await this.syncRunExecutionStatuses();
      if (this.status !== "running") return;

      // 2. Find workflows that need execution
      const availableSlots = this.config.maxConcurrentExecutions -
        this.activeExecutions.size - this.teardownCandidates.size;
      // Timed waits are durable state, not child-process timers. Event
      // deadlines are reconciled even with no execution capacity; delay wakes
      // are bounded by available capacity and returned in deadline order.
      const recovered = await this.timedWaitRecovery.recover({
        now: Date.now(),
        maxAwakened: Math.max(0, availableSlots),
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
      if (availableSlots <= 0) return;

      // Get pending workflows from queue
      const remainingPendingSlots = availableSlots - recovered.awakenedRuns.length;
      const pendingCandidates = remainingPendingSlots > 0
        ? await this.config.backend.listRuns({
          status: "pending",
          // A just-awakened run is already pending and can also appear in this
          // query. Read enough rows to remove those duplicates without losing
          // another admission slot, while keeping each poll within the shared
          // backend page bound. Larger concurrency targets fill on later polls.
          limit: Math.min(availableSlots, MAX_WORKFLOW_RUN_LIST_LIMIT),
        })
        : [];
      const recoveredRunIds = new Set(recovered.awakenedRuns.map((run) => run.id));
      const pendingRuns = pendingCandidates.filter((run) => !recoveredRunIds.has(run.id)).slice(
        0,
        remainingPendingSlots,
      );
      if (this.status !== "running") return;

      // Also check for stalled workflows (crashed run executions)
      let stalledRuns: WorkflowRun[] = [];
      if (hasWorkerSupport(this.config.backend)) {
        stalledRuns = await this.config.backend.findStalledRuns(this.config.stalledThreshold);
        if (this.status !== "running") return;

        if (stalledRuns.length > 0 && this.config.debug) {
          logger.info(
            `[WorkflowRunManager] Found ${stalledRuns.length} stalled runs to recover`,
          );
        }
      }

      // Combine pending and stalled runs
      const runsToProcess: WorkflowRun[] = [];
      const selectedRunIds = new Set<string>();
      for (const run of [...recovered.awakenedRuns, ...pendingRuns, ...stalledRuns]) {
        if (selectedRunIds.has(run.id)) continue;
        selectedRunIds.add(run.id);
        runsToProcess.push(run);
        if (runsToProcess.length === availableSlots) break;
      }

      for (const run of runsToProcess) {
        if (this.status !== "running") return;
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
      await this.retryTeardownCandidates();
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
      lockRetryInterval: this.config.lockRetryInterval,
      executionTimeout: this.config.executionTimeout,
      env: this.config.env ?? {},
      debug: this.config.debug,
      isAdmissionOpen: () => this.status === "running",
      createRunExecution: (config) => this.config.executor.createRunExecution(config),
      deleteRunExecution: (executionId) => this.config.executor.deleteRunExecution(executionId),
    });

    if (outcome.teardownCandidate) {
      this.teardownCandidates.set(
        outcome.teardownCandidate.executionId,
        {
          ...outcome.teardownCandidate,
          initialError: outcome.error,
        },
      );
    }

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
      return;
    }

    if (outcome.status === "skipped-claim-lost" && outcome.error) {
      this.stats.executionsFailed++;
      logger.error(`Lost run claim while creating execution for ${run.id}:`, outcome.error);
    }
  }

  /** Serialize executor teardown across failed startup and explicit shutdown. */
  private destroyExecutor(): Promise<void> {
    if (this.executorDestroyed) return Promise.resolve();
    if (this.executorDestroyPromise) return this.executorDestroyPromise;

    const destroyAttempt = (async () => {
      await this.config.executor.destroy?.();
      this.executorDestroyed = true;
    })();
    const trackedAttempt = destroyAttempt.finally(() => {
      if (this.executorDestroyPromise === trackedAttempt) {
        this.executorDestroyPromise = undefined;
      }
    });
    this.executorDestroyPromise = trackedAttempt;
    return trackedAttempt;
  }

  /**
   * Once executor teardown confirms that children cannot mutate durable state,
   * requeue only runs still owned by those exact executions. A replacement or
   * terminal owner wins the compare-and-set and is left untouched.
   */
  private async requeueStoppedExecutions(): Promise<void> {
    for (const [runId, execution] of this.activeExecutions) {
      await this.requeueTerminatedExecution(execution);
      this.activeExecutions.delete(runId);
    }

    for (const [executionId, candidate] of this.teardownCandidates) {
      await this.drainTeardownCandidate(candidate);
      this.teardownCandidates.delete(executionId);
    }
  }

  /** Retry ambiguous per-execution cleanup while the manager remains live. */
  private async retryTeardownCandidates(): Promise<void> {
    for (const [executionId, candidate] of this.teardownCandidates) {
      try {
        await this.drainTeardownCandidate(candidate);
        this.teardownCandidates.delete(executionId);
      } catch (error) {
        logger.warn(
          `[WorkflowRunManager] Cleanup remains pending for run execution ${executionId}:`,
          error,
        );
      }
    }
  }

  /** Delete the child idempotently before releasing its exact durable owner. */
  private async drainTeardownCandidate(candidate: TeardownCandidate): Promise<void> {
    try {
      await this.config.executor.deleteRunExecution(candidate.executionId);
      await this.requeueTerminatedExecution(candidate);
    } catch (error) {
      const cleanupError = ensureError(error);
      if (!candidate.initialError) throw cleanupError;
      throw ORCHESTRATION_ERROR.create({
        detail: `Could not drain retained workflow execution "${candidate.executionId}"`,
        cause: new AggregateError(
          [candidate.initialError, cleanupError],
          "Workflow run claim and retained teardown both failed",
        ),
      });
    }
  }

  /** Requeue only the exact durable owner whose execution has terminated. */
  private async requeueTerminatedExecution(execution: TeardownCandidate): Promise<void> {
    const workerId = `run-execution:${execution.executionId}`;
    const requeued = await updateRunIfStatus(
      this.config.backend,
      execution.runId,
      ["running"],
      { status: "pending" },
      workerId,
    );
    if (requeued) return;

    const latest = await this.config.backend.getRun(execution.runId);
    if (latest?.status === "running" && latest.workerId === workerId) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Could not requeue stopped workflow execution "${execution.executionId}"`,
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
 * Create a workflow run manager backed by run executors.
 */
export function createWorkflowRunManager(
  config: WorkflowRunManagerConfig,
): WorkflowRunManager {
  return new WorkflowRunManager(config);
}
