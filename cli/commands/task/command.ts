/**
 * Task command - Discover and run a task from the tasks/ directory
 *
 * Finds the specified task file, imports it, and calls its run() function
 * with a local execution context.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import { INVALID_ARGUMENT, RESOURCE_NOT_FOUND } from "veryfront/errors";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { sanitizeRunOutputForLogging } from "../../utils/sanitize-run-output.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import type { TaskArgs } from "./handler.ts";

export interface TaskOptions extends TaskArgs {}

export function parseTaskConfig(value: string | undefined): Record<string, unknown> {
  if (value === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw INVALID_ARGUMENT.create({
      detail: "Invalid --config JSON: must be a valid JSON object",
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw INVALID_ARGUMENT.create({
      detail: "Invalid --config JSON: must be a valid JSON object",
    });
  }
  return parsed as Record<string, unknown>;
}

export function taskDiscoverySourceLabel(
  proxyContext: { branchRef?: string | null } | null | undefined,
): string {
  if (proxyContext?.branchRef) return `branch ${proxyContext.branchRef}`;
  return proxyContext ? "main" : "tasks/...";
}

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
  const { runWithProjectAgentRuntime } = await import(
    "../../../src/agent/project/agent-runtime.ts"
  );
  const { runTask } = await import(
    "../../../src/task/runner.ts"
  );

  const taskName = options.name;
  if (!taskName) {
    throw INVALID_ARGUMENT.create({
      detail: "Task name is required. Usage: veryfront task <name>",
    });
  }

  const projectDir = Deno.cwd();
  await withProjectSourceContext(
    projectDir,
    async ({ adapter, config, configCacheKey, projectId, proxyContext }) => {
      const sourceLabel = taskDiscoverySourceLabel(proxyContext);

      cliLogger.info(`Discovering tasks in ${sourceLabel}`);

      const discovery = await discoverProjectTaskRuntime({
        projectDir,
        adapter,
        config,
        fsAdapter: adapter.fs,
        cacheKey: configCacheKey,
        debug: options.debug,
        allowHostProjectCodeExecution: true,
      });
      logRuntimeDiscoveryWarnings(discovery.errors, options.debug);

      const task = findProjectRuntimeTask(discovery, taskName);
      if (!task) {
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
        throw RESOURCE_NOT_FOUND.create({ detail: `Task "${taskName}" not found.` });
      }

      const taskConfig = parseTaskConfig(options.config);

      cliLogger.info(`Running task: ${task.name} (${task.id})`);
      cliLogger.info("");

      const result = await runWithProjectAgentRuntime(
        discovery,
        () =>
          runTask({
            task,
            config: taskConfig,
            projectId,
            debug: options.debug,
          }),
      );

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
