/**
 * Task Types
 *
 * Type definitions for the task execution system.
 * Tasks are user-defined functions in `tasks/` that can run
 * locally via `veryfront task <name>` or in the cloud as runs and schedules.
 */

import { normalizeTaskDefinition } from "./definition.ts";

/** Context passed to a task's `run` function. */
export interface TaskContext {
  /** Validated environment variables available to this invocation. */
  env: Record<string, string>;
  /** Private mutable snapshot of the invocation configuration. */
  config: Record<string, unknown>;
  /** Project identifier when the platform supplies one. */
  projectId?: string;
  /** Environment identifier for the runtime target executing this task. */
  environmentId?: string;
}

/** Task definition exported from a file under `tasks/`. */
export interface TaskDefinition {
  /** Human-readable task name. */
  name?: string;
  /** Human-readable task description. */
  description?: string;
  /** Optional JSON-shaped input contract surfaced in APIs and UIs. */
  inputSchema?: Record<string, unknown>;
  /** Optional JSON-shaped output contract surfaced in APIs and UIs. */
  outputSchema?: Record<string, unknown>;
  /** Whether a schedule can target this task. */
  schedulable?: boolean;
  /** Execute the task with an invocation-scoped context. */
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}

/** Return whether a value satisfies the complete task definition contract. */
export function isTaskDefinition(value: unknown): value is TaskDefinition {
  try {
    normalizeTaskDefinition(value);
    return true;
  } catch {
    return false;
  }
}
