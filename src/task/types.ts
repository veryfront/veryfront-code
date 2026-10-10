/**
 * Task Types
 *
 * Type definitions for the task execution system.
 * Tasks are user-defined functions in `tasks/` that can run
 * locally via `veryfront task <name>` or in the cloud as runs and schedules.
 */

import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import { captureTaskDefinition } from "./definition-snapshot.ts";

/** A durable child invocation under the current project Task. */
export interface TaskChildRequest {
  /** Project definition to execute under this Task's durable lineage. */
  target: { type: "agent" | "workflow" | "task"; id: string };
  input?: unknown;
  /** Stable invocation identity; retries reuse this key and the same input. */
  idempotencyKey: string;
}

/** Context passed to a task run function. */
export interface TaskContext {
  /**
   * Execute a child in the same project/runtime and return its output.
   * Uses the current Task's durable parent and original credential; callers do not supply authority.
   * Failed/cancelled children and an aborted invocation throw. Parent failure/cancellation closes descendants.
   * Project runtimes provide this capability; local CLI contexts omit it.
   */
  runChild?: (request: TaskChildRequest) => Promise<unknown>;
  /** Environment variables */
  env: Record<string, string>;
  /** Run config: execution settings (when executed by the platform) */
  config: Record<string, unknown>;
  /**
   * Business input submitted with the run (`request.input`). It can be any JSON value.
   * When the run was created without input (a `null` input counts as none), `input` falls
   * back to `config`, so tasks that read business data from `config` keep working.
   */
  input?: unknown;
  /** Public run ID (when executed by the platform) */
  runId?: string;
  /** Project ID (when executed by the platform) */
  projectId?: string;
  /** Environment ID for the runtime target executing this task */
  environmentId?: string;
  /** Cooperative cancellation for request- or runtime-scoped execution */
  signal?: AbortSignal;
  /**
   * 1-based attempt number. A project task run starts again, with a higher
   * attempt, only after it threw a `RetryableError` or the runtime never
   * started it; see `backoff_limit`. `runTask` always sets it (1 when the
   * caller gives none); it is optional only so hand-built contexts, such as
   * in tests, need not name it.
   */
  attempt?: number;
}

/**
 * Task definition exported from a tasks/ file
 */
export interface TaskDefinition {
  /** Human-readable name */
  name?: string;
  /** Task description */
  description?: string;
  /** Optional input contract: a `defineSchema` schema or a raw JSON Schema object. */
  inputSchema?: Schema<unknown> | Record<string, unknown>;
  /** Optional output contract: a `defineSchema` schema or a raw JSON Schema object. */
  outputSchema?: Schema<unknown> | Record<string, unknown>;
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
