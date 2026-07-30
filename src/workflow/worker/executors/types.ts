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

  /** Bounded lock acquisition policy for the isolated entrypoint. */
  lockAcquisition: {
    duration: number;
    timeout: number;
    retryInterval: number;
  };
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
   * Spawn and register an isolated execution, preserving config.executionId.
   * Resolve as soon as the execution is visible to status/list/delete calls;
   * do not wait for its child lock acquisition, readiness, or completion. The
   * manager still owns the claim lease until this promise resolves.
   *
   * The execution must invoke a standard managed workflow entrypoint with the
   * run ID, execution ID, and lockAcquisition values from config. These values
   * are reserved control-plane inputs and config.env must never override them.
   * A rejection must leave no live execution, or leave it discoverable by the
   * requested executionId so the manager's cleanup call can terminate it.
   *
   * @returns Exactly config.executionId
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
   * Terminate and remove an execution. This operation must be idempotent and
   * must not resolve until the execution can no longer perform workflow work.
   */
  deleteRunExecution(executionId: string): Promise<void>;

  /**
   * Initialize the executor once before first execution creation. If this
   * rejects after allocating resources, the manager invokes destroy() and the
   * executor is terminal; a new manager/executor pair is required to retry.
   */
  initialize?(): Promise<void>;

  /**
   * Perform terminal teardown. This must not resolve until every execution
   * owned by the executor can no longer perform workflow work. Repeated calls
   * must either join the same teardown or remain safe and idempotent.
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
