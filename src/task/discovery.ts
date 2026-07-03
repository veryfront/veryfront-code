/**
 * Task Discovery
 *
 * Discovers task definitions from user's project `tasks/` directory.
 * Follows the same patterns as workflow-discovery.ts.
 *
 * Scans:
 * - tasks/*.ts - task definition files
 * - tasks/**\/*.ts - nested task files
 *
 * Task files should export a task definition:
 * ```typescript
 * export default {
 *   name: "Sync external data",
 *   run: async (ctx) => {
 *     console.log("Syncing data...")
 *     return { synced: 42 }
 *   }
 * }
 * ```
 */

import { join } from "@std/path";
import { logger as baseLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { TaskDefinition } from "./types.ts";
import { isTaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-discovery");
const TASK_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const TASK_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;

/**
 * Discovered task info.
 *
 * @deprecated Use project runtime discovery helpers from `veryfront/task`
 * instead. Runtime discovery keeps tasks, tools, agents, and cloud runs on the
 * same project discovery path.
 */
export interface DiscoveredTask {
  /** Task ID derived from file path (e.g., "sync-data" from tasks/sync-data.ts) */
  id: string;

  /** Human-readable name from task definition */
  name: string;

  /** File path where the task is defined */
  filePath: string;

  /** Export name (e.g., "default" or named export) */
  exportName: string;

  /** The task definition */
  definition: TaskDefinition;
}

/**
 * Options for file-based task discovery.
 *
 * @deprecated Use `discoverProjectTaskRuntime` instead.
 */
export interface TaskDiscoveryOptions {
  /** Project directory */
  projectDir: string;

  /** Runtime adapter for filesystem operations */
  adapter: RuntimeAdapter;

  /** Veryfront config (for import maps, etc.) */
  config?: VeryfrontConfig;

  /** Base directory for tasks (default: "tasks") */
  tasksDir?: string;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of file-based task discovery.
 *
 * @deprecated Use `DiscoveryResult` from project runtime discovery instead.
 */
export interface TaskDiscoveryResult {
  /** All discovered tasks */
  tasks: DiscoveredTask[];

  /** Errors encountered during discovery */
  errors: Array<{ filePath: string; error: string }>;
}

function resolveTasksBaseDir(
  projectDir: string,
  tasksDir: string,
  config?: VeryfrontConfig,
): string {
  const fsType = config?.fs?.type ?? "local";
  return fsType === "github" || fsType === "veryfront-api" ? tasksDir : join(projectDir, tasksDir);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectTaskFiles(baseDir: string, adapter: RuntimeAdapter): Promise<
  Awaited<ReturnType<typeof collectFiles>>
> {
  return await collectFiles({
    baseDir,
    extensions: [...TASK_FILE_EXTENSIONS],
    recursive: true,
    ignorePatterns: [...TASK_IGNORE_PATTERNS],
    adapter,
  });
}

function extractTaskExport(
  module: Record<string, unknown>,
): { exportName: string; definition: TaskDefinition } | null {
  const defaultExport = module.default;
  if (isTaskDefinition(defaultExport)) {
    return { exportName: "default", definition: defaultExport };
  }

  for (const [exportName, value] of Object.entries(module)) {
    if (exportName !== "default" && isTaskDefinition(value)) {
      return { exportName, definition: value };
    }
  }

  return null;
}

async function loadTaskFromFile(
  filePath: string,
  id: string,
  adapter: RuntimeAdapter,
  projectDir: string,
): Promise<DiscoveredTask | null> {
  const module = await importDiscoveryModule(filePath, {
    adapter,
    projectDir,
  }) as Record<string, unknown>;
  const taskExport = extractTaskExport(module);
  if (!taskExport) return null;

  return {
    id,
    name: taskExport.definition.name || id,
    filePath,
    exportName: taskExport.exportName,
    definition: taskExport.definition,
  };
}

function logDiscoveredTask(task: DiscoveredTask, debug: boolean): void {
  if (debug) {
    logger.info(`Found task "${task.id}" in ${task.filePath} (export: ${task.exportName})`);
  }
}

/**
 * Derive task ID from file path (e.g., "tasks/sync-data.ts" -> "sync-data").
 *
 * @deprecated Use project runtime task IDs from `discoverProjectTaskRuntime`
 * instead.
 */
export function deriveTaskId(filePath: string, tasksDir: string): string {
  // Remove the tasks dir prefix and extension
  let relative = filePath;
  const dirPrefix = tasksDir.endsWith("/") ? tasksDir : `${tasksDir}/`;
  if (relative.startsWith(dirPrefix)) {
    relative = relative.slice(dirPrefix.length);
  }
  // Remove extension
  return relative.replace(/\.(ts|tsx|js|jsx)$/, "");
}

/**
 * Discover all tasks in a project with the legacy file-based path.
 *
 * @deprecated Use `discoverProjectTaskRuntime` instead.
 */
export async function discoverTasks(
  options: TaskDiscoveryOptions,
): Promise<TaskDiscoveryResult> {
  const {
    projectDir,
    adapter,
    config,
    tasksDir = "tasks",
    debug = false,
  } = options;

  const tasks: DiscoveredTask[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  const baseDir = resolveTasksBaseDir(projectDir, tasksDir, config);

  if (debug) {
    logger.info(`Scanning ${baseDir} for tasks`);
  }

  try {
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) {
      if (debug) {
        logger.info(`No tasks directory found at ${baseDir}`);
      }
      return { tasks, errors };
    }

    const files = await collectTaskFiles(baseDir, adapter);

    if (debug) {
      logger.info(`Found ${files.length} potential task files`);
    }

    for (const file of files) {
      try {
        const task = await loadTaskFromFile(
          file.path,
          deriveTaskId(file.path, baseDir),
          adapter,
          projectDir,
        );
        if (task) {
          tasks.push(task);
          logDiscoveredTask(task, debug);
        }
      } catch (error) {
        const errorMsg = toErrorMessage(error);
        errors.push({ filePath: file.path, error: errorMsg });

        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }

    if (debug) {
      logger.info(`Discovered ${tasks.length} tasks`);
    }

    return { tasks, errors };
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error(`Task discovery failed: ${errorMsg}`);
    errors.push({ filePath: baseDir, error: errorMsg });
    return { tasks, errors };
  }
}

/**
 * Find a specific task by ID through the legacy file-based path.
 *
 * @deprecated Use `discoverProjectTaskRuntime` and `findProjectRuntimeTask`
 * instead.
 */
export async function findTaskById(
  taskId: string,
  options: TaskDiscoveryOptions,
): Promise<DiscoveredTask | null> {
  const {
    projectDir,
    adapter,
    config,
    tasksDir = "tasks",
    debug = false,
  } = options;
  const baseDir = resolveTasksBaseDir(projectDir, tasksDir, config);

  try {
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) return null;

    const files = await collectTaskFiles(baseDir, adapter);

    for (const file of files) {
      const id = deriveTaskId(file.path, baseDir);
      if (id !== taskId) continue;

      try {
        const task = await loadTaskFromFile(file.path, id, adapter, projectDir);
        if (task) {
          logDiscoveredTask(task, debug);
          return task;
        }
      } catch (error) {
        const errorMsg = toErrorMessage(error);
        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error(`Task discovery failed while finding "${taskId}": ${errorMsg}`);
  }

  return null;
}
