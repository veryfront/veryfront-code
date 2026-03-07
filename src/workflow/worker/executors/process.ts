/**
 * Process Job Executor
 *
 * Executes workflow jobs as child processes.
 * Useful for local development and testing without containerization.
 *
 * Each workflow runs in a separate Deno subprocess with its own environment.
 */

import { WORKFLOW_JOB_PERMISSIONS } from "#veryfront/security/deno-permissions.ts";
import { logger as baseLogger } from "#veryfront/utils";
import type { JobConfig, JobExecutor, JobInfo, JobStatus } from "./types.ts";

const logger = baseLogger.component("process-job-executor");

/**
 * Process Job Executor configuration
 */
export interface ProcessJobExecutorConfig {
  /** Command to run (default: "deno") */
  command?: string;

  /** Arguments for the command */
  args?: string[];

  /** Path to the job entrypoint script */
  entrypointPath: string;

  /** Working directory for spawned processes */
  cwd?: string;

  /** Additional environment variables */
  env?: Record<string, string>;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Internal job tracking
 */
interface TrackedJob {
  jobId: string;
  runId: string;
  managerId: string;
  process: Deno.ChildProcess;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Process Job Executor
 *
 * Spawns child processes for each workflow job.
 * Provides isolation at the process level (separate memory space).
 *
 * @example
 * ```typescript
 * const executor = new ProcessJobExecutor({
 *   entrypointPath: "./src/workflow-job.ts",
 *   env: {
 *     REDIS_URL: "redis://localhost:6379",
 *   },
 * });
 *
 * const manager = new WorkflowJobManager({
 *   backend,
 *   executor,
 * });
 * ```
 */
export class ProcessJobExecutor implements JobExecutor {
  private config: Required<Omit<ProcessJobExecutorConfig, "cwd" | "env">> & {
    cwd?: string;
    env?: Record<string, string>;
  };
  private activeJobs = new Map<string, TrackedJob>();

  constructor(config: ProcessJobExecutorConfig) {
    this.config = {
      command: "deno",
      args: ["run", ...WORKFLOW_JOB_PERMISSIONS],
      debug: false,
      ...config,
    };
  }

  createJob(jobConfig: JobConfig): Promise<string> {
    const { jobId, run, managerId, timeout, env, debug } = jobConfig;

    // Build environment variables
    const processEnv: Record<string, string> = {
      ...this.config.env,
      ...env,
      MODE: "job",
      WORKFLOW_RUN_ID: run.id,
      JOB_ID: jobId,
    };

    // Add tenant context
    if (run._tenant) {
      processEnv.TENANT_PROJECT_SLUG = run._tenant.projectSlug;
      processEnv.TENANT_TOKEN = run._tenant.token;
      processEnv.TENANT_PROJECT_ID = run._tenant.projectId ?? "";
      processEnv.TENANT_PRODUCTION_MODE = run._tenant.productionMode ? "1" : "0";
      processEnv.TENANT_RELEASE_ID = run._tenant.releaseId ?? "";
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

    const job: TrackedJob = {
      jobId,
      runId: run.id,
      managerId,
      process,
      status: "running",
      createdAt: new Date(),
      startedAt: new Date(),
    };

    this.activeJobs.set(jobId, job);

    if (debug || this.config.debug) {
      logger.info(`Spawned process for job ${jobId}, run ${run.id}`);
    }

    // Monitor the process in background
    this.monitorProcess(job, timeout);

    return Promise.resolve(jobId);
  }

  getJobStatus(jobId: string): Promise<JobInfo | null> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.toJobInfo(job));
  }

  listJobs(managerId: string): Promise<JobInfo[]> {
    const jobs: JobInfo[] = [];

    for (const job of this.activeJobs.values()) {
      if (job.managerId === managerId) {
        jobs.push(this.toJobInfo(job));
      }
    }

    return Promise.resolve(jobs);
  }

  deleteJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return Promise.resolve();
    }

    // Kill the process if still running
    if (job.status === "running" || job.status === "pending") {
      try {
        job.process.kill("SIGTERM");
      } catch (_) {
        /* expected: process may already be dead */
      }
    }

    this.activeJobs.delete(jobId);

    if (this.config.debug) {
      logger.info(`Deleted job ${jobId}`);
    }

    return Promise.resolve();
  }

  destroy(): Promise<void> {
    // Kill all active processes
    for (const job of this.activeJobs.values()) {
      if (job.status === "running" || job.status === "pending") {
        try {
          job.process.kill("SIGTERM");
        } catch (_) {
          /* expected: process may already be dead */
        }
      }
    }

    this.activeJobs.clear();

    return Promise.resolve();
  }

  /**
   * Monitor a process and update its status when it exits
   */
  private monitorProcess(job: TrackedJob, timeout: number): void {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (job.status === "running") {
        try {
          job.process.kill("SIGTERM");
          job.status = "failed";
          job.error = `Job timed out after ${timeout}ms`;
          job.completedAt = new Date();

          logger.warn(`Job ${job.jobId} timed out`);
        } catch (_) {
          /* expected: process may already be dead */
        }
      }
    }, timeout);

    // Wait for process to complete
    job.process.status.then((status) => {
      clearTimeout(timeoutId);

      job.completedAt = new Date();

      if (job.status === "failed") {
        // Already marked as failed (e.g. timeout) — don't overwrite
        return;
      }

      if (status.success) {
        job.status = "succeeded";

        if (this.config.debug) {
          logger.info(`Job ${job.jobId} succeeded`);
        }
      } else {
        job.status = "failed";
        job.error = `Process exited with code ${status.code}`;

        logger.error(`Job ${job.jobId} failed with code ${status.code}`);
      }
    }).catch((error) => {
      clearTimeout(timeoutId);

      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date();

      logger.error(`Job ${job.jobId} error:`, error);
    });

    // Log stdout/stderr in debug mode
    if (this.config.debug) {
      this.streamOutput(job);
    }
  }

  /**
   * Stream process output to logs
   */
  private streamOutput(job: TrackedJob): void {
    const decoder = new TextDecoder();

    // Stream stdout
    const stdout = job.process.stdout;
    if (stdout) {
      (async () => {
        for await (const chunk of stdout) {
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.debug(`[Job ${job.jobId}] ${text}`);
          }
        }
      })().catch(() => {
        // Ignore stream errors
      });
    }

    // Stream stderr
    const stderr = job.process.stderr;
    if (stderr) {
      (async () => {
        for await (const chunk of stderr) {
          const text = decoder.decode(chunk).trim();
          if (text) {
            logger.error(`[Job ${job.jobId}] ${text}`);
          }
        }
      })().catch(() => {
        // Ignore stream errors
      });
    }
  }

  /**
   * Convert tracked job to JobInfo
   */
  private toJobInfo(job: TrackedJob): JobInfo {
    return {
      jobId: job.jobId,
      runId: job.runId,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      metadata: {
        pid: job.process.pid,
        command: this.config.command,
      },
    };
  }
}
