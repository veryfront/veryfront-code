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

/**
 * Discovered task info
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
 * Options for task discovery
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
 * Result of task discovery
 */
export interface TaskDiscoveryResult {
  /** All discovered tasks */
  tasks: DiscoveredTask[];

  /** Errors encountered during discovery */
  errors: Array<{ filePath: string; error: string }>;
}

/**
 * Derive task ID from file path (e.g., "tasks/sync-data.ts" → "sync-data")
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
 * Discover all tasks in a project
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

  const fsType = config?.fs?.type ?? "local";
  const useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  const baseDir = useRelativePaths ? tasksDir : join(projectDir, tasksDir);

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

    const files = await collectFiles({
      baseDir,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      recursive: true,
      ignorePatterns: ["node_modules", ".git", "__tests__", "*.test.*", "*.spec.*"],
      adapter,
    });

    if (debug) {
      logger.info(`Found ${files.length} potential task files`);
    }

    for (const file of files) {
      try {
        const module = await importDiscoveryModule(file.path, {
          adapter,
          projectDir,
        });

        // Prefer default export (aligned with discovery-engine behaviour)
        const defaultExport = module.default;
        if (isTaskDefinition(defaultExport)) {
          const id = deriveTaskId(file.path, baseDir);
          tasks.push({
            id,
            name: defaultExport.name || id,
            filePath: file.path,
            exportName: "default",
            definition: defaultExport,
          });

          if (debug) {
            logger.info(`Found task "${id}" in ${file.path} (export: default)`);
          }
        } else {
          // Fallback: check named exports
          for (const [exportName, value] of Object.entries(module)) {
            if (exportName === "default") continue;
            if (isTaskDefinition(value)) {
              const id = deriveTaskId(file.path, baseDir);
              tasks.push({
                id,
                name: value.name || id,
                filePath: file.path,
                exportName,
                definition: value,
              });

              if (debug) {
                logger.info(`Found task "${id}" in ${file.path} (export: ${exportName})`);
              }
              break; // Only take the first valid named export per file
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Task discovery failed: ${errorMsg}`);
    errors.push({ filePath: baseDir, error: errorMsg });
    return { tasks, errors };
  }
}

/**
 * Find a specific task by ID, short-circuiting discovery once found.
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

  const fsType = config?.fs?.type ?? "local";
  const useRelativePaths = fsType === "github" || fsType === "veryfront-api";
  const baseDir = useRelativePaths ? tasksDir : join(projectDir, tasksDir);

  try {
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) return null;

    const files = await collectFiles({
      baseDir,
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      recursive: true,
      ignorePatterns: ["node_modules", ".git", "__tests__", "*.test.*", "*.spec.*"],
      adapter,
    });

    for (const file of files) {
      const id = deriveTaskId(file.path, baseDir);
      if (id !== taskId) continue;

      try {
        const module = await importDiscoveryModule(file.path, {
          adapter,
          projectDir,
        });

        const defaultExport = module.default;
        if (isTaskDefinition(defaultExport)) {
          if (debug) {
            logger.info(`Found task "${id}" in ${file.path} (export: default)`);
          }
          return {
            id,
            name: defaultExport.name || id,
            filePath: file.path,
            exportName: "default",
            definition: defaultExport,
          };
        }

        for (const [exportName, value] of Object.entries(module)) {
          if (exportName === "default") continue;
          if (isTaskDefinition(value)) {
            if (debug) {
              logger.info(`Found task "${id}" in ${file.path} (export: ${exportName})`);
            }
            return {
              id,
              name: value.name || id,
              filePath: file.path,
              exportName,
              definition: value,
            };
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (debug) {
          logger.warn(`Failed to load ${file.path}: ${errorMsg}`);
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Task discovery failed while finding "${taskId}": ${errorMsg}`);
  }

  return null;
}
