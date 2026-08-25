/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { getErrorMessage } from "#veryfront/errors";
import { type HostRuntime, liveHostRuntime } from "#veryfront/platform/compat/process.ts";
import { buildTaskContextEnv } from "#veryfront/runs/runtime-env.ts";
import { logger as baseLogger } from "#veryfront/utils";
import type { TaskContext } from "./types.ts";
import type { TaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-runner");
const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

export interface RunnableTask {
  /** Stable task id used by CLI, triggers, and cloud runs. */
  id: string;

  /** Human-readable task name. */
  name: string;

  /** The task definition to execute. */
  definition: TaskDefinition;
}

/**
 * Options for running a task
 */
export interface RunTaskOptions {
  /** The discovered task to run */
  task: RunnableTask;

  /** Additional config to pass to the task */
  config?: Record<string, unknown>;

  /** Project ID (for cloud context) */
  projectId?: string;

  /** Environment ID for the runtime target executing this task */
  environmentId?: string;

  /** Cooperative cancellation propagated to the task context */
  signal?: AbortSignal;

  /** If set, only these env var names are passed to the task. */
  envAllowlist?: string[];

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of running a task
 */
export interface TaskRunResult {
  /** Whether the task completed successfully */
  success: boolean;

  /** Return value from the task's run() */
  result?: unknown;

  /** Error if the task failed */
  error?: string;

  /** Execution duration in milliseconds */
  durationMs: number;
}

function elapsedMilliseconds(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function assertInjectedTaskEnvIsValid(allEnv: Record<string, string>): void {
  const serialized = allEnv[INJECTED_TASK_ENV_JSON];
  if (!serialized) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`, { cause });
  }
  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`);
  }
}

/**
 * Run a task with the given options
 *
 * @param options Task definition and execution context.
 * @param host Host environment boundary. Omit it to use the current process.
 */
export async function runTask(
  options: RunTaskOptions,
  host: HostRuntime = liveHostRuntime(),
): Promise<TaskRunResult> {
  const {
    task,
    config = {},
    projectId,
    environmentId,
    signal,
    envAllowlist,
    debug = false,
  } = options;
  const start = performance.now();

  try {
    signal?.throwIfAborted();

    if (debug) {
      logger.info(`Running task "${task.id}" (${task.name})`);
    }

    const allEnv = host.env.toObject();
    assertInjectedTaskEnvIsValid(allEnv);
    const env = buildTaskContextEnv(allEnv, envAllowlist);
    const ctx: TaskContext = {
      env,
      config,
      projectId,
      environmentId,
      ...(signal === undefined ? {} : { signal }),
    };

    const result = await task.definition.run(ctx);
    const durationMs = elapsedMilliseconds(start);

    if (debug) {
      logger.info(`Task "${task.id}" completed in ${durationMs}ms`);
    }

    return { success: true, result, durationMs };
  } catch (error) {
    const durationMs = elapsedMilliseconds(start);
    const errorMsg = getErrorMessage(error);

    logger.error(`Task "${task.id}" failed: ${errorMsg}`);

    return { success: false, error: errorMsg, durationMs };
  }
}
