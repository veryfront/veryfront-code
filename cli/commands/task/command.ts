/**
 * Task command - Discover and run a task from the tasks/ directory
 *
 * Finds the specified task file, imports it, and calls its run() function
 * with a local execution context.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { sanitizeRunOutputForLogging } from "../../utils/sanitize-run-output.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import type { TaskArgs } from "./handler.ts";

export interface TaskOptions extends TaskArgs {}

function logRuntimeDiscoveryWarnings(
  errors: Array<{ file: string; error: Error }>,
  debug: boolean | undefined,
): void {
  if (errors.length === 0 || !debug) return;

  for (const err of errors) {
    cliLogger.warn(`  Warning: ${err.file}: ${err.error.message}`);
  }
}

export async function taskCommand(options: TaskOptions): Promise<void> {
  const { discoverProjectTaskRuntime, findProjectRuntimeTask, listProjectRuntimeTasks } =
    await import(
      "../../../src/task/project-runtime.ts"
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
  await withProjectSourceContext(
    projectDir,
    async ({ adapter, config, configCacheKey, projectId, proxyContext }) => {
      const sourceLabel = proxyContext?.branchRef
        ? `branch ${proxyContext.branchRef}`
        : proxyContext
        ? "main"
        : `${projectDir}/tasks/...`;

      cliLogger.info(`Discovering tasks in ${sourceLabel}`);

      const discovery = await discoverProjectTaskRuntime({
        projectDir,
        adapter,
        config,
        fsAdapter: adapter.fs,
        cacheKey: configCacheKey,
        debug: options.debug,
      });
      logRuntimeDiscoveryWarnings(discovery.errors, options.debug);

      const task = findProjectRuntimeTask(discovery, taskName);
      if (!task) {
        cliLogger.error(`Task "${taskName}" not found.`);
        if (discovery.errors.length > 0 && !options.debug) {
          cliLogger.warn(
            "Some project files could not be loaded. Re-run with --debug for details.",
          );
        }
        const tasks = listProjectRuntimeTasks(discovery);
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

      let taskConfig: Record<string, unknown> = {};
      if (options.config) {
        try {
          taskConfig = JSON.parse(options.config);
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
        config: taskConfig,
        projectId,
        debug: options.debug,
      });

      cliLogger.info("");
      if (result.success) {
        cliLogger.info(`Task completed in ${result.durationMs}ms`);
        if (result.result !== undefined) {
          await writeRunResultIfConfigured(result.result);
          cliLogger.info(
            `Result: ${JSON.stringify(sanitizeRunOutputForLogging(result.result), null, 2)}`,
          );
        }
        return;
      }

      cliLogger.error(`Task failed after ${result.durationMs}ms: ${result.error}`);
      exitProcess(1);
    },
  );
}
