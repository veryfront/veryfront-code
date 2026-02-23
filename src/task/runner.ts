/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type { DiscoveredTask } from "./discovery.ts";
import type { TaskContext } from "./types.ts";

const logger = baseLogger.component("task-runner");

/**
 * Options for running a task
 */
export interface RunTaskOptions {
  /** The discovered task to run */
  task: DiscoveredTask;

  /** Additional config to pass to the task */
  config?: Record<string, unknown>;

  /** Project ID (for cloud context) */
  projectId?: string;

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
  const { task, config = {}, projectId, debug = false } = options;
  const start = Date.now();

  if (debug) {
    logger.info(`Running task "${task.id}" (${task.name})`);
  }

  const ctx: TaskContext = {
    env: { ...Deno.env.toObject() },
    config,
    projectId,
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
