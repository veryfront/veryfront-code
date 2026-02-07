/**
 * Job Executor Interface
 *
 * Abstraction layer for executing workflow jobs in isolated environments.
 * Implementations can target different runtimes:
 * - K8s Jobs
 * - Docker containers
 * - Local processes
 * - Cloud Run / Lambda / Fargate
 */

import type { WorkflowRun } from "../../types.ts";

/**
 * Job configuration passed to executor
 */
export interface JobConfig {
  /** Unique job ID */
  jobId: string;

  /** Workflow run to execute */
  run: WorkflowRun;

  /** Manager ID for tracking */
  managerId: string;

  /** Job timeout in milliseconds */
  timeout: number;

  /** Environment variables to inject */
  env: Record<string, string>;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Job execution status
 */
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "unknown";

/**
 * Job information returned by executor
 */
export interface JobInfo {
  /** Unique job identifier */
  jobId: string;

  /** Workflow run ID */
  runId: string;

  /** Current status */
  status: JobStatus;

  /** When job was created */
  createdAt: Date;

  /** When job started executing */
  startedAt?: Date;

  /** When job completed */
  completedAt?: Date;

  /** Error message if failed */
  error?: string;

  /** Executor-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Job Executor Interface
 *
 * Abstracts the runtime environment for executing workflow jobs.
 * Each implementation handles the specifics of its target platform.
 *
 * @example K8s
 * ```typescript
 * const executor = new K8sJobExecutor({
 *   namespace: "workflows",
 *   image: "my-app:latest",
 * });
 * ```
 *
 * @example Docker
 * ```typescript
 * const executor = new DockerJobExecutor({
 *   image: "my-app:latest",
 *   network: "workflow-network",
 * });
 * ```
 *
 * @example Local Process
 * ```typescript
 * const executor = new ProcessJobExecutor({
 *   command: "deno",
 *   args: ["run", "job-entrypoint.ts"],
 * });
 * ```
 */
export interface JobExecutor {
  /**
   * Create and start a job for a workflow run
   * @returns Job ID
   */
  createJob(config: JobConfig): Promise<string>;

  /**
   * Get the current status of a job
   */
  getJobStatus(jobId: string): Promise<JobInfo | null>;

  /**
   * List all active jobs created by a specific manager
   */
  listJobs(managerId: string): Promise<JobInfo[]>;

  /**
   * Delete/cleanup a job
   * Called after job completion or for manual cleanup
   */
  deleteJob(jobId: string): Promise<void>;

  /**
   * Initialize the executor (optional)
   * Called once before first job creation
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup and shutdown the executor (optional)
   * Called when the manager is stopping
   */
  destroy?(): Promise<void>;
}

/**
 * Type guard to check if an object implements JobExecutor
 */
export function isJobExecutor(obj: unknown): obj is JobExecutor {
  if (!obj || typeof obj !== "object") return false;
  const executor = obj as JobExecutor;
  return (
    typeof executor.createJob === "function" &&
    typeof executor.getJobStatus === "function" &&
    typeof executor.listJobs === "function" &&
    typeof executor.deleteJob === "function"
  );
}
