/**
 * Process run executor
 *
 * Executes workflow runs as child processes.
 * Useful for local development and testing without containerization.
 *
 * Each workflow runs in a separate Deno subprocess with its own environment.
 */

import { WORKFLOW_RUN_PERMISSIONS } from "#veryfront/security/deno-permissions.ts";
import { logger as baseLogger } from "#veryfront/utils";
import type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutionStatus,
  RunExecutor,
} from "./types.ts";

const logger = baseLogger.component("process-run-executor");

/**
 * Process run executor configuration
 */
export interface ProcessRunExecutorConfig {
  /** Command to run (default: "deno") */
  command?: string;

  /** Arguments for the command */
  args?: string[];

  /** Path to the workflow run entrypoint script */
  entrypointPath: string;

  /** Working directory for spawned processes */
  cwd?: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Internal execution tracking
 */
interface TrackedExecution {
  executionId: string;
  runId: string;
  managerId: string;
  process: Deno.ChildProcess;
  status: RunExecutionStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Process run executor
 *
 * Spawns child processes for each workflow run.
 * Provides isolation at the process level (separate memory space).
 *
 * @example
 * ```typescript
 * const executor = new ProcessRunExecutor({
 *   entrypointPath: "./src/workflow-run-entrypoint.ts",
 *   env: {
 *     REDIS_URL: "redis://localhost:6379",
 *   },
 * });
 *
 * const manager = new WorkflowRunManager({
 *   backend,
 *   executor,
 * });
 * ```
 */
export class ProcessRunExecutor implements RunExecutor {
  private config: Required<Omit<ProcessRunExecutorConfig, "cwd" | "env">> & {
    cwd?: string;
    env?: Record<string, string>;
  };
  private activeExecutions = new Map<string, TrackedExecution>();

  constructor(config: ProcessRunExecutorConfig) {
    this.config = {
      command: "deno",
      args: ["run", ...WORKFLOW_RUN_PERMISSIONS],
      debug: false,
      ...config,
    };
  }

  createRunExecution(executionConfig: RunExecutionConfig): Promise<string> {
    const { executionId, run, managerId, timeout, env, debug } = executionConfig;

    // Build environment variables
    const processEnv: Record<string, string> = {
      ...this.config.env,
      ...env,
      MODE: "run",
      WORKFLOW_RUN_ID: run.id,
      RUN_EXECUTION_ID: executionId,
    };

    // Add tenant context
    if (run._tenant) {
      processEnv.TENANT_PROJECT_SLUG = run._tenant.projectSlug;
      processEnv.TENANT_TOKEN = run._tenant.token;
      processEnv.TENANT_PROJECT_ID = run._tenant.projectId ?? "";
      processEnv.TENANT_PRODUCTION_MODE = run._tenant.productionMode ? "1" : "0";
      processEnv.TENANT_RELEASE_ID = run._tenant.releaseId ?? "";
      if (run._tenant.branch) {
        processEnv.TENANT_BRANCH_ID = run._tenant.branch;
        processEnv.VERYFRONT_BRANCH_REF = run._tenant.branch;
      }
      if (run._tenant.environmentName) {
        processEnv.TENANT_ENVIRONMENT_NAME = run._tenant.environmentName;
        processEnv.VERYFRONT_ENVIRONMENT_NAME = run._tenant.environmentName;
      }
    }

    // Spawn the process
    const command = new Deno.Command(this.config.command, {
      args: [...this.config.args, this.config.entrypointPath],
      cwd: this.config.cwd,
      env: processEnv,
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    const execution: TrackedExecution = {
      executionId,
      runId: run.id,
      managerId,
      process,
      status: "running",
      createdAt: new Date(),
      startedAt: new Date(),
    };

    this.activeExecutions.set(executionId, execution);

    if (debug || this.config.debug) {
      logger.info(`Spawned process for run execution ${executionId}, run ${run.id}`);
    }

    // Monitor the process in background
    this.monitorProcess(execution, timeout);

    return Promise.resolve(executionId);
  }

  getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.toRunExecutionInfo(execution));
  }

  listRunExecutions(managerId: string): Promise<RunExecutionInfo[]> {
    const executions: RunExecutionInfo[] = [];

    for (const execution of this.activeExecutions.values()) {
      if (execution.managerId === managerId) {
        executions.push(this.toRunExecutionInfo(execution));
      }
    }

    return Promise.resolve(executions);
  }

  deleteRunExecution(executionId: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      return Promise.resolve();
    }

    // Kill the process if still running
    if (execution.status === "running" || execution.status === "pending") {
      try {
        execution.process.kill("SIGTERM");
      } catch (_) {
        /* expected: process may already be dead */
      }
    }

    if (execution.timeoutId) clearTimeout(execution.timeoutId);
    this.activeExecutions.delete(executionId);

    if (this.config.debug) {
      logger.info(`Deleted run execution ${executionId}`);
    }

    return Promise.resolve();
  }

  destroy(): Promise<void> {
    // Kill all active processes and clear their timers
    for (const execution of this.activeExecutions.values()) {
      if (execution.timeoutId) clearTimeout(execution.timeoutId);
      if (execution.status === "running" || execution.status === "pending") {
        try {
          execution.process.kill("SIGTERM");
        } catch (_) {
          /* expected: process may already be dead */
        }
      }
    }

    this.activeExecutions.clear();

    return Promise.resolve();
  }

  /**
   * Monitor a process and update its status when it exits
   */
  private monitorProcess(execution: TrackedExecution, timeout: number): void {
    // Set up timeout
    execution.timeoutId = setTimeout(() => {
      execution.timeoutId = undefined;
      if (execution.status === "running") {
        try {
          execution.process.kill("SIGTERM");
          execution.status = "failed";
          execution.error = `Run execution timed out after ${timeout}ms`;
          execution.completedAt = new Date();

          logger.warn(`Run execution ${execution.executionId} timed out`);
        } catch (_) {
          /* expected: process may already be dead */
        }
      }
    }, timeout);

    // Wait for process to complete (fire-and-forget with error handling)
    void (async () => {
      try {
        const status = await execution.process.status;
        clearTimeout(execution.timeoutId);
        execution.timeoutId = undefined;

        execution.completedAt = new Date();

        if (execution.status === "failed") {
          // Already marked as failed (e.g. timeout) — don't overwrite
          return;
        }

        if (status.success) {
          execution.status = "succeeded";

          if (this.config.debug) {
            logger.info(`Run execution ${execution.executionId} succeeded`);
          }
        } else {
          execution.status = "failed";
          execution.error = `Process exited with code ${status.code}`;

          logger.error(`Run execution ${execution.executionId} failed with code ${status.code}`);
        }
      } catch (error) {
        clearTimeout(execution.timeoutId);
        execution.timeoutId = undefined;

        execution.status = "failed";
        execution.error = error instanceof Error ? error.message : String(error);
        execution.completedAt = new Date();

        logger.error(`Run execution ${execution.executionId} error:`, error);
      }
    })();

    // Log stdout/stderr in debug mode
    if (this.config.debug) {
      this.streamOutput(execution);
    }
  }

  /**
   * Stream process output to logs
   */
  private streamOutput(execution: TrackedExecution): void {
    const decoder = new TextDecoder();

    // Stream stdout
    const stdout = execution.process.stdout;
    if (stdout) {
      (async () => {
        for await (const chunk of stdout) {
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.debug(`[RunExecution ${execution.executionId}] ${text}`);
          }
        }
      })().catch(() => {
        // Ignore stream errors
      });
    }

    // Stream stderr
    const stderr = execution.process.stderr;
    if (stderr) {
      (async () => {
        for await (const chunk of stderr) {
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.error(`[RunExecution ${execution.executionId}] ${text}`);
          }
        }
      })().catch(() => {
        // Ignore stream errors
      });
    }
  }

  /**
   * Convert tracked execution to RunExecutionInfo
   */
  private toRunExecutionInfo(execution: TrackedExecution): RunExecutionInfo {
    return {
      executionId: execution.executionId,
      runId: execution.runId,
      status: execution.status,
      createdAt: execution.createdAt,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      error: execution.error,
      metadata: {
        pid: execution.process.pid,
        command: this.config.command,
      },
    };
  }
}
