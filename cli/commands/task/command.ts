/**
 * Task command - Discover and run a task from the tasks/ directory
 *
 * Finds the specified task file, imports it, and calls its run() function
 * with a local execution context.
 */

import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { sanitizeRunOutputForLogging } from "../../utils/sanitize-run-output.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import type { TaskArgs } from "./handler.ts";

export interface TaskOptions extends TaskArgs {}

export function taskSourceLabel(
  proxyContext: { branchRef?: string | null } | null | undefined,
): string {
  if (proxyContext?.branchRef) {
    const branchRef = sanitizeErrorText(proxyContext.branchRef, 256)
      .replaceAll("\u061C", "")
      .replace(/[\r\n\t]+/g, " ")
      .trim();
    return branchRef ? `branch ${branchRef}` : "selected branch";
  }
  return proxyContext ? "main" : "local tasks";
}

export function parseTaskConfig(value: string | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Task config must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function formatRuntimeDiscoveryWarningLines(
  formattedErrors: readonly string[],
  debug: boolean | undefined,
): string[] {
  if (!debug) return [];

  return formattedErrors.map((line) => `  Warning: ${line}`);
}

export async function taskCommand(options: TaskOptions): Promise<void> {
  const {
    discoverProjectTaskRuntime,
    findProjectRuntimeTask,
    formatProjectRuntimeDiscoveryErrors,
    listProjectRuntimeTasks,
  } = await import(
    "../../../src/task/project-runtime.ts"
  );
  const { normalizeTaskId } = await import("../../../src/task/id.ts");
  const { runWithProjectAgentRuntime } = await import(
    "../../../src/agent/project/agent-runtime.ts"
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
  let taskId: string;
  try {
    taskId = normalizeTaskId(taskName, "Task name");
  } catch {
    cliLogger.error("Task name must be a canonical lowercase identifier.");
    exitProcess(1);
    return;
  }

  const projectDir = Deno.cwd();
  await withProjectSourceContext(
    projectDir,
    async ({ adapter, config, configCacheKey, projectId, proxyContext }) => {
      const sourceLabel = taskSourceLabel(proxyContext);

      cliLogger.info(`Discovering tasks in ${sourceLabel}`);

      const discovery = await discoverProjectTaskRuntime({
        projectDir,
        adapter,
        config,
        fsAdapter: adapter.fs,
        cacheKey: configCacheKey,
        debug: options.debug,
      });
      const warningLines = formatRuntimeDiscoveryWarningLines(
        options.debug ? formatProjectRuntimeDiscoveryErrors(discovery.errors, projectDir) : [],
        options.debug,
      );
      for (const line of warningLines) cliLogger.warn(line);

      const task = findProjectRuntimeTask(discovery, taskId);
      if (!task) {
        cliLogger.error(`Task "${taskId}" not found.`);
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

      let taskConfig: Record<string, unknown>;
      try {
        taskConfig = parseTaskConfig(options.config);
      } catch {
        cliLogger.error("Invalid --config JSON object");
        exitProcess(1);
        return;
      }

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
