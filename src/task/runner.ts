/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { env as getProcessEnv } from "#veryfront/compat/process.ts";
import { buildTaskContextEnv } from "#veryfront/runs/runtime-env.ts";
import type { TaskContext } from "./types.ts";
import type { TaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-runner");

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

/**
 * Run a task with the given options
 */
export async function runTask(options: RunTaskOptions): Promise<TaskRunResult> {
  const { task, config = {}, projectId, environmentId, envAllowlist, debug = false } = options;
  const start = Date.now();

  if (debug) {
    logger.info(`Running task "${task.id}" (${task.name})`);
  }

  const allEnv = getProcessEnv();
  const env = buildTaskContextEnv(allEnv, envAllowlist);

  const ctx: TaskContext = {
    env,
    config,
    projectId,
    environmentId,
  };

  try {
    const result = await task.definition.run(ctx);
    const durationMs = Date.now() - start;

    if (debug) {
      logger.info(`Task "${task.id}" completed in ${durationMs}ms`);
    }

    return { success: true, result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error(`Task "${task.id}" failed: ${errorMsg}`);

    return { success: false, error: errorMsg, durationMs };
  }
}
