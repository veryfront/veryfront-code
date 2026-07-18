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
const FORCE_KILL_DELAY_MS = 5_000;

/**
 * Non-secret host env vars forwarded to the child when its environment is
 * cleared (clearEnv). These let the spawned Deno runtime locate its module
 * cache, temp dir, TLS roots and locale. clearEnv prevents ordinary environment
 * inheritance, but it is not a sandbox boundary: this executor is for trusted
 * local code because the child retains broad filesystem and network access.
 */
const RUNTIME_INFRA_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "DENO_DIR",
  "DENO_INSTALL_ROOT",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "DENO_TLS_CA_STORE",
  "DENO_CERT",
  "LANG",
  "LC_ALL",
  // Windows runtime essentials
  "SYSTEMROOT",
  "SystemRoot",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "PATHEXT",
] as const;

/** Collect the forwardable runtime-infra env vars present on the host. */
function collectRuntimeInfraEnv(): Record<string, string> {
  const infra: Record<string, string> = {};
  if (typeof Deno === "undefined") return infra;
  for (const key of RUNTIME_INFRA_ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value !== undefined) infra[key] = value;
  }
  return infra;
}

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
  forceKillTimeoutId?: ReturnType<typeof setTimeout>;
  exited: boolean;
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

    // Build environment variables. Start from the forwarded runtime-infra vars
    // (needed because the child spawns with clearEnv:true) so operator- and
    // run-supplied values still take precedence over them.
    const processEnv: Record<string, string> = {
      ...collectRuntimeInfraEnv(),
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

    // Spawn the process.
    // clearEnv drops the inherited host environment so the child sees ONLY the
    // explicitly-assembled processEnv (mode/run IDs and tenant context). This
    // prevents ordinary host-env inheritance but does not sandbox untrusted code.
    const command = new Deno.Command(this.config.command, {
      args: [...this.config.args, this.config.entrypointPath],
      cwd: this.config.cwd,
      clearEnv: true,
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
      exited: false,
    };

    this.activeExecutions.set(executionId, execution);

    if (debug || this.config.debug) {
      logger.info(`Spawned process for run execution ${executionId}, run ${run.id}`);
    }

    // Monitor the process in background
    this.monitorProcess(execution, timeout, debug || this.config.debug);

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
    this.terminateProcess(execution);

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
      this.terminateProcess(execution);
    }

    this.activeExecutions.clear();

    return Promise.resolve();
  }

  /**
   * Monitor a process and update its status when it exits
   */
  private monitorProcess(
    execution: TrackedExecution,
    timeout: number,
    debug: boolean,
  ): void {
    // Set up timeout
    execution.timeoutId = setTimeout(() => {
      execution.timeoutId = undefined;
      if (execution.status === "running") {
        execution.status = "failed";
        execution.error = `Run execution timed out after ${timeout}ms`;
        execution.completedAt = new Date();
        this.terminateProcess(execution);

        logger.warn(`Run execution ${execution.executionId} timed out`);
      }
    }, timeout);

    // Wait for process to complete (fire-and-forget with error handling)
    void (async () => {
      try {
        const status = await execution.process.status;
        execution.exited = true;
        clearTimeout(execution.timeoutId);
        clearTimeout(execution.forceKillTimeoutId);
        execution.timeoutId = undefined;
        execution.forceKillTimeoutId = undefined;

        execution.completedAt = new Date();

        if (execution.status === "failed") {
          // Already marked as failed (e.g. timeout) — don't overwrite
          return;
        }

        if (status.success) {
          execution.status = "succeeded";

          if (debug) {
            logger.info(`Run execution ${execution.executionId} succeeded`);
          }
        } else {
          execution.status = "failed";
          execution.error = `Process exited with code ${status.code}`;

          logger.error(`Run execution ${execution.executionId} failed with code ${status.code}`);
        }
      } catch (error) {
        execution.exited = true;
        clearTimeout(execution.timeoutId);
        clearTimeout(execution.forceKillTimeoutId);
        execution.timeoutId = undefined;
        execution.forceKillTimeoutId = undefined;

        execution.status = "failed";
        execution.error = error instanceof Error ? error.message : String(error);
        execution.completedAt = new Date();

        logger.error(`Run execution ${execution.executionId} error:`, error);
      }
    })();

    // Piped output must always be consumed. Otherwise a child that fills an OS
    // pipe buffer blocks forever before its status can resolve.
    this.streamOutput(execution, debug);
  }

  private terminateProcess(execution: TrackedExecution): void {
    if (execution.exited) return;

    try {
      execution.process.kill("SIGTERM");
    } catch (_) {
      /* expected: process may already be dead */
      return;
    }

    if (execution.forceKillTimeoutId) return;
    execution.forceKillTimeoutId = setTimeout(() => {
      execution.forceKillTimeoutId = undefined;
      if (execution.exited) return;
      try {
        execution.process.kill("SIGKILL");
      } catch (_) {
        /* expected: process may have exited after the check */
      }
    }, FORCE_KILL_DELAY_MS);
  }

  /**
   * Stream process output to logs
   */
  private streamOutput(execution: TrackedExecution, debug: boolean): void {
    // Stream stdout
    const stdout = execution.process.stdout;
    if (stdout) {
      (async () => {
        const decoder = debug ? new TextDecoder() : null;
        for await (const chunk of stdout) {
          if (!decoder) continue;
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.debug(`[RunExecution ${execution.executionId}] ${text}`);
          }
        }
      })().catch((error) => {
        logger.debug(
          `[RunExecution ${execution.executionId}] stdout stream error:`,
          error,
        );
      });
    }

    // Stream stderr
    const stderr = execution.process.stderr;
    if (stderr) {
      (async () => {
        const decoder = debug ? new TextDecoder() : null;
        for await (const chunk of stderr) {
          if (!decoder) continue;
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.error(`[RunExecution ${execution.executionId}] ${text}`);
          }
        }
      })().catch((error) => {
        // stderr often carries the only diagnostic for a failing subprocess —
        // don't discard a failure to read it.
        logger.warn(
          `[RunExecution ${execution.executionId}] stderr stream error:`,
          error,
        );
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
