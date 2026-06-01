/**
 * Run executor interface
 *
 * Abstraction layer for executing workflow runs in isolated environments.
 * Implementations can target different runtimes:
 * - Docker containers
 * - Local processes
 * - Cloud Run / Lambda / Fargate
 */

import type { WorkflowRun } from "../../types.ts";

/**
 * Run execution configuration passed to executor
 */
export interface RunExecutionConfig {
  /** Unique execution ID */
  executionId: string;

  /** Workflow run to execute */
  run: WorkflowRun;

  /** Manager ID for tracking */
  managerId: string;

  /** Run timeout in milliseconds */
  timeout: number;

  /** Environment variables to inject */
  env: Record<string, string>;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Run execution status
 */
export type RunExecutionStatus = "pending" | "running" | "succeeded" | "failed" | "unknown";

/**
 * Run execution information returned by executor
 */
export interface RunExecutionInfo {
  /** Unique execution identifier */
  executionId: string;

  /** Workflow run ID */
  runId: string;

  /** Current status */
  status: RunExecutionStatus;

  /** When execution was created */
  createdAt: Date;

  /** When execution started */
  startedAt?: Date;

  /** When execution completed */
  completedAt?: Date;

  /** Error message if failed */
  error?: string;

  /** Executor-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Run Executor Interface
 *
 * Abstracts the runtime environment for executing workflow runs.
 * Each implementation handles the specifics of its target platform.
 *
 * @example Local Process
 * ```typescript
 * const executor = new ProcessRunExecutor({
 *   command: "deno",
 *   args: ["run", "run-entrypoint.ts"],
 * });
 * ```
 *
 * @example Custom runtime target
 * ```typescript
 * const executor = new RuntimeTargetExecutor({
 *   invokeUrl: "https://project.example.com/api/control-plane/runs",
 * });
 * ```
 */
export interface RunExecutor {
  /**
   * Create and start an isolated execution for a workflow run.
   * @returns Execution ID
   */
  createRunExecution(config: RunExecutionConfig): Promise<string>;

  /**
   * Get the current status of an execution.
   */
  getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null>;

  /**
   * List all active executions created by a specific manager.
   */
  listRunExecutions(managerId: string): Promise<RunExecutionInfo[]>;

  /**
   * Delete/cleanup an execution.
   * Called after completion or for manual cleanup.
   */
  deleteRunExecution(executionId: string): Promise<void>;

  /**
   * Initialize the executor (optional)
   * Called once before first execution creation.
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup and shutdown the executor (optional)
   * Called when the manager is stopping
   */
  destroy?(): Promise<void>;
}

/**
 * Type guard to check if an object implements RunExecutor
 */
export function isRunExecutor(obj: unknown): obj is RunExecutor {
  if (!obj || typeof obj !== "object") return false;
  const executor = obj as RunExecutor;
  return (
    typeof executor.createRunExecution === "function" &&
    typeof executor.getRunExecutionStatus === "function" &&
    typeof executor.listRunExecutions === "function" &&
    typeof executor.deleteRunExecution === "function"
  );
}
