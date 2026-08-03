/**
 * Task Types
 *
 * Type definitions for the task execution system.
 * Tasks are user-defined functions in `tasks/` that can run
 * locally via `veryfront task <name>` or in the cloud as runs and schedules.
 */

/**
 * Context passed to task run() function
 */
export interface TaskContext {
  /** Environment variables */
  env: Record<string, string>;
  /** Run config (when executed by the platform) */
  config: Record<string, unknown>;
  /** Project ID (when executed by the platform) */
  projectId?: string;
  /** Environment ID for the runtime target executing this task */
  environmentId?: string;
  /** Cooperative cancellation for request- or runtime-scoped execution */
  signal?: AbortSignal;
}

/**
 * Task definition exported from a tasks/ file
 */
export interface TaskDefinition {
  /** Human-readable name */
  name?: string;
  /** Task description */
  description?: string;
  /** Optional JSON-schema-like input contract surfaced in APIs/UIs */
  inputSchema?: Record<string, unknown>;
  /** Optional JSON-schema-like output contract surfaced in APIs/UIs */
  outputSchema?: Record<string, unknown>;
  /** Whether this task can be scheduled */
  schedulable?: boolean;
  /** The function to execute */
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalRecord(
  value: unknown,
): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

/**
 * Return true only when the runnable and every declared task metadata field
 * match the public `TaskDefinition` contract.
 */
export function isTaskDefinition(value: unknown): value is TaskDefinition {
  if (!isRecord(value)) return false;
  return typeof value.run === "function" &&
    isOptionalString(value.name) &&
    isOptionalString(value.description) &&
    isOptionalRecord(value.inputSchema) &&
    isOptionalRecord(value.outputSchema) &&
    (value.schedulable === undefined || typeof value.schedulable === "boolean");
}
