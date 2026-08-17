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

import { fromFileUrl, join } from "#veryfront/compat/path";
import { logger as baseLogger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { TaskDefinition } from "./types.ts";
import { captureTaskDefinition, isTaskDefinitionCandidate } from "./definition-snapshot.ts";

const logger = baseLogger.component("task-discovery");
const TASK_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const TASK_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;

function normalizeTaskDiscoveryPath(value: string): string {
  const fromUrl = value.startsWith("file://");
  const path = fromUrl ? fromFileUrl(value) : value;
  const normalized = path.replaceAll("\\", "/");
  // `fromFileUrl()` represents a Windows drive URL as `/C:/...` on POSIX.
  // Normalize that transport-only leading slash so it matches an authored
  // Windows tasks directory without changing ordinary POSIX paths.
  return fromUrl && /^\/[A-Za-z]:\//.test(normalized) ? normalized.slice(1) : normalized;
}

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

  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function collectTaskFiles(baseDir: string, adapter: RuntimeAdapter): Promise<
  Awaited<ReturnType<typeof collectFiles>>
> {
  const files = await collectFiles({
    baseDir,
    extensions: [...TASK_FILE_EXTENSIONS],
    recursive: true,
    ignorePatterns: [...TASK_IGNORE_PATTERNS],
    adapter,
  });
  return files.sort((left, right) =>
    compareText(left.path.replaceAll("\\", "/"), right.path.replaceAll("\\", "/"))
  );
}

function extractTaskExport(
  module: Record<string, unknown>,
): { exportName: string; definition: TaskDefinition } | null {
  const defaultExport = module.default;
  if (isTaskDefinitionCandidate(defaultExport)) {
    return { exportName: "default", definition: captureTaskDefinition(defaultExport) };
  }

  for (const [exportName, value] of Object.entries(module)) {
    if (exportName !== "default" && isTaskDefinitionCandidate(value)) {
      return { exportName, definition: captureTaskDefinition(value) };
    }
  }

  return null;
}

async function loadTaskFromFile(
  filePath: string,
  id: string,
  adapter: RuntimeAdapter,
  projectDir: string,
  allowHostProjectCodeExecution?: boolean,
): Promise<DiscoveredTask | null> {
  const module = await importDiscoveryModule(filePath, {
    adapter,
    projectDir,
    allowHostProjectCodeExecution,
  }) as Record<string, unknown>;
  const taskExport = extractTaskExport(module);
  if (!taskExport) return null;

  return {
    id,
    name: typeof taskExport.definition.name === "string" &&
        taskExport.definition.name.trim().length > 0
      ? taskExport.definition.name
      : id,
    filePath,
    exportName: taskExport.exportName,
    definition: taskExport.definition,
  };
}

function finalizeTaskDiscoveryResult(
  tasks: DiscoveredTask[],
  errors: TaskDiscoveryResult["errors"],
): TaskDiscoveryResult {
  const tasksById = new Map<string, DiscoveredTask[]>();
  for (const task of tasks) {
    const matches = tasksById.get(task.id) ?? [];
    matches.push(task);
    tasksById.set(task.id, matches);
  }

  const uniqueTasks: DiscoveredTask[] = [];
  for (const [id, matches] of tasksById) {
    if (matches.length === 1) {
      uniqueTasks.push(matches[0]!);
      continue;
    }

    const paths = matches.map((task) => task.filePath).sort(compareText);
    for (const filePath of paths) {
      errors.push({
        filePath,
        error: `Duplicate task id "${id}" was declared by: ${paths.join(", ")}`,
      });
    }
  }

  uniqueTasks.sort((left, right) =>
    compareText(left.id, right.id) || compareText(left.filePath, right.filePath)
  );
  errors.sort((left, right) =>
    compareText(left.filePath, right.filePath) || compareText(left.error, right.error)
  );
  return { tasks: uniqueTasks, errors };
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
  let relative = normalizeTaskDiscoveryPath(filePath);
  const normalizedTasksDir = normalizeTaskDiscoveryPath(tasksDir).replace(/\/+$/, "");
  const dirPrefix = normalizedTasksDir === "" ? "/" : `${normalizedTasksDir}/`;
  if (relative.startsWith(dirPrefix)) {
    relative = relative.slice(dirPrefix.length);
  }
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
    allowHostProjectCodeExecution,
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
      return finalizeTaskDiscoveryResult(tasks, errors);
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
          allowHostProjectCodeExecution,
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
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error(`Task discovery failed: ${errorMsg}`);
    errors.push({ filePath: baseDir, error: errorMsg });
  }

  const result = finalizeTaskDiscoveryResult(tasks, errors);
  if (debug) {
    logger.info(`Discovered ${result.tasks.length} tasks`);
  }
  return result;
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
    allowHostProjectCodeExecution,
  } = options;
  const baseDir = resolveTasksBaseDir(projectDir, tasksDir, config);

  try {
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) return null;

    const files = await collectTaskFiles(baseDir, adapter);
    const matches: DiscoveredTask[] = [];

    for (const file of files) {
      const id = deriveTaskId(file.path, baseDir);
      if (id !== taskId) continue;

      try {
        const task = await loadTaskFromFile(
          file.path,
          id,
          adapter,
          projectDir,
          allowHostProjectCodeExecution,
        );
        if (task) {
          matches.push(task);
        }
      } catch (error) {
        const errorMsg = toErrorMessage(error);
        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }

    if (matches.length > 1) {
      const paths = matches.map((task) => task.filePath).sort(compareText);
      logger.error(
        `Task id "${taskId}" is ambiguous and was declared by: ${paths.join(", ")}`,
      );
      return null;
    }

    const task = matches[0] ?? null;
    if (task) logDiscoveredTask(task, debug);
    return task;
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error(`Task discovery failed while finding "${taskId}": ${errorMsg}`);
  }

  return null;
}
