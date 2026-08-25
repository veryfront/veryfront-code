/**
 * Task Types
 *
 * Type definitions for the task execution system.
 * Tasks are user-defined functions in `tasks/` that can run
 * locally via `veryfront task <name>` or in the cloud as runs and schedules.
 */

import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import { captureTaskDefinition } from "./definition-snapshot.ts";

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
  /** Explicit integration scopes and resources required by scheduled runs. */
  integrationRequirements?: ScheduleIntegrationRequirementConfig[];
  /** Whether this task can be scheduled */
  schedulable?: boolean;
  /** The function to execute */
  run: (ctx: TaskContext) => Promise<unknown> | unknown;
}

/**
 * Return true only when the runnable and every declared task metadata field
 * match the public `TaskDefinition` contract.
 */
export function isTaskDefinition(value: unknown): value is TaskDefinition {
  try {
    captureTaskDefinition(value);
    return true;
  } catch {
    return false;
  }
}
