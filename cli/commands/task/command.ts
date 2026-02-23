/**
 * Task command - Discover and run a task from the tasks/ directory
 *
 * Finds the specified task file, imports it, and calls its run() function
 * with a local execution context.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import type { TaskArgs } from "./handler.ts";

export interface TaskOptions extends TaskArgs {}

export async function taskCommand(options: TaskOptions): Promise<void> {
  const { getAdapter } = await import(
    "../../../src/platform/adapters/detect.ts"
  );
  const { discoverTasks } = await import(
    "../../../src/task/discovery.ts"
  );
  const { runTask } = await import(
    "../../../src/task/runner.ts"
  );

  const taskName = options.name;
  if (!taskName) {
    cliLogger.error("Task name is required. Usage: veryfront task <name>");
    exitProcess(1);
    return;
  }

  const projectDir = Deno.cwd();
  const adapter = await getAdapter();

  cliLogger.info(`Discovering tasks in ${projectDir}/tasks/...`);

  const { tasks, errors } = await discoverTasks({
    projectDir,
    adapter,
    debug: options.debug,
  });

  if (errors.length > 0 && options.debug) {
    for (const err of errors) {
      cliLogger.warn(`  Warning: ${err.filePath}: ${err.error}`);
    }
  }

  const task = tasks.find((t) => t.id === taskName);
  if (!task) {
    cliLogger.error(`Task "${taskName}" not found.`);
    if (tasks.length > 0) {
      cliLogger.info("Available tasks:");
      for (const t of tasks) {
        cliLogger.info(`  - ${t.id}${t.name !== t.id ? ` (${t.name})` : ""}`);
      }
    } else {
      cliLogger.info("No tasks found. Create a task file in tasks/ directory:");
      cliLogger.info("  tasks/my-task.ts");
    }
    exitProcess(1);
    return;
  }

  // Parse config JSON if provided
  let config: Record<string, unknown> = {};
  if (options.config) {
    try {
      config = JSON.parse(options.config);
    } catch {
      cliLogger.error("Invalid --config JSON");
      exitProcess(1);
      return;
    }
  }

  cliLogger.info(`Running task: ${task.name} (${task.id})`);
  cliLogger.info("");

  const result = await runTask({
    task,
    config,
    debug: options.debug,
  });

  cliLogger.info("");
  if (result.success) {
    cliLogger.info(`Task completed in ${result.durationMs}ms`);
    if (result.result !== undefined) {
      cliLogger.info(`Result: ${JSON.stringify(result.result, null, 2)}`);
    }
  } else {
    cliLogger.error(`Task failed after ${result.durationMs}ms: ${result.error}`);
    exitProcess(1);
  }
}
