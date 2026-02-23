/**
 * Task Types
 *
 * Type definitions for the task execution system.
 * Tasks are user-defined functions in `tasks/` that can run
 * locally via `veryfront task <name>` or in the cloud as Jobs/CronJobs.
 */

/**
 * Context passed to task run() function
 */
export interface TaskContext {
  /** Environment variables */
  env: Record<string, string>;
  /** Job config (when run as a cloud job) */
  config: Record<string, unknown>;
  /** Project ID (when run as a cloud job) */
  projectId?: string;
}

/**
 * Task definition exported from a tasks/ file
 */
export interface TaskDefinition {
  /** Human-readable name */
  name?: string;
  /** Task description */
  description?: string;
  /** The function to execute */
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}

/**
 * Type guard: checks if a value looks like a TaskDefinition
 */
export function isTaskDefinition(value: unknown): value is TaskDefinition {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.run === "function";
}
