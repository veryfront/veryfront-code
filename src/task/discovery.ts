/**
 * Legacy file-based task discovery.
 *
 * Scans supported script modules under a project-relative task directory.
 * Task files can export a task definition:
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

import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { TaskDefinition } from "./types.ts";
import { hasTaskDefinitionRunMember, normalizeTaskDefinition } from "./definition.ts";
import { isCanonicalTaskId, normalizeTaskId } from "./id.ts";

const logger = baseLogger.component("task-discovery");
const TASK_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"] as const;
const TASK_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;
const MAX_TASK_FILES = 10_000;
const MAX_TASK_EXPORTS = 256;
const MAX_PROJECT_DIR_LENGTH = 4_096;
const MAX_TASKS_DIR_LENGTH = 1_024;

/**
 * Discovered task info.
 *
 * @deprecated Use project runtime discovery helpers from `veryfront/task`
 * instead. Runtime discovery keeps tasks, tools, agents, and cloud runs on the
 * same project discovery path.
 */
export interface DiscoveredTask {
  /** Task ID derived from its project-relative file path. */
  id: string;

  /** Human-readable name from the task definition. */
  name: string;

  /** Project-relative file path containing the definition. */
  filePath: string;

  /** Module export name, such as `default`. */
  exportName: string;

  /** Detached validated task definition. */
  definition: TaskDefinition;
}

/**
 * Options for file-based task discovery.
 *
 * @deprecated Use `discoverProjectTaskRuntime` instead.
 */
export interface TaskDiscoveryOptions {
  /** Project root used to resolve the task directory. */
  projectDir: string;

  /** Runtime adapter used for filesystem operations and module loading. */
  adapter: RuntimeAdapter;

  /** Resolved Veryfront configuration used for module loading. */
  config?: VeryfrontConfig;

  /** Project-relative task directory. Defaults to `tasks`. */
  tasksDir?: string;

  /** Enable sanitized diagnostic logging. */
  debug?: boolean;

  /** Cancel discovery before another task file is loaded. */
  signal?: AbortSignal;
}

/** A contained failure encountered during legacy task discovery. */
export interface TaskDiscoveryError {
  /** Project-relative source location associated with the failure. */
  filePath: string;
  /** Stable public failure message without underlying implementation details. */
  error: string;
}

/**
 * Result of file-based task discovery.
 *
 * @deprecated Use `DiscoveryResult` from project runtime discovery instead.
 */
export interface TaskDiscoveryResult {
  /** Successfully discovered tasks in deterministic source order. */
  tasks: DiscoveredTask[];

  /** Contained failures encountered during discovery. */
  errors: TaskDiscoveryError[];
}

interface TaskDiscoverySnapshot {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig | undefined;
  tasksDir: string;
  debug: boolean;
  signal: AbortSignal | undefined;
  fsType: "local" | "memory" | "github" | "veryfront-api";
}

interface TaskFile {
  path: string;
}

function invalidOptions(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function readOwnDataProperty(value: unknown, key: string, label: string): unknown {
  if (!value || typeof value !== "object") invalidOptions(`${label} is required.`);
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) invalidOptions(`${label}.${key} must be a data property.`);
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions(`${label} could not be inspected safely.`);
  }
}

function normalizeTasksDir(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_TASKS_DIR_LENGTH ||
    hasUnsafeControlCharacters(value) || value.includes("\u061C") || isAbsolute(value)
  ) {
    invalidOptions("Task discovery tasksDir must be a bounded project-relative path.");
  }
  const segments = value.split(/[\\/]/);
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.length > 255
    )
  ) {
    invalidOptions("Task discovery tasksDir must not contain empty or relative path segments.");
  }
  return normalize(value).replaceAll("\\", "/");
}

function readConfiguredFsType(
  config: VeryfrontConfig | undefined,
): TaskDiscoverySnapshot["fsType"] {
  if (config === undefined) return "local";
  const fs = readOwnDataProperty(config, "fs", "Task discovery config");
  if (fs === undefined) return "local";
  const type = readOwnDataProperty(fs, "type", "Task discovery config.fs") ?? "local";
  if (type !== "local" && type !== "memory" && type !== "github" && type !== "veryfront-api") {
    invalidOptions("Task discovery config.fs.type is not supported.");
  }
  return type;
}

function snapshotDiscoveryOptions(value: TaskDiscoveryOptions): TaskDiscoverySnapshot {
  const projectDir = readOwnDataProperty(value, "projectDir", "Task discovery options");
  const adapter = readOwnDataProperty(value, "adapter", "Task discovery options");
  const config = readOwnDataProperty(value, "config", "Task discovery options");
  const tasksDir = normalizeTasksDir(
    readOwnDataProperty(value, "tasksDir", "Task discovery options") ?? "tasks",
  );
  const debug = readOwnDataProperty(value, "debug", "Task discovery options") ?? false;
  const signal = readOwnDataProperty(value, "signal", "Task discovery options");

  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > MAX_PROJECT_DIR_LENGTH || hasUnsafeControlCharacters(projectDir) ||
    projectDir.includes("\u061C")
  ) {
    invalidOptions("Task discovery projectDir must be a bounded non-empty path.");
  }
  if (!adapter || typeof adapter !== "object") {
    invalidOptions("Task discovery adapter is required.");
  }
  if (config !== undefined && (!config || typeof config !== "object")) {
    invalidOptions("Task discovery config must be an object when provided.");
  }
  if (typeof debug !== "boolean") {
    invalidOptions("Task discovery debug must be a boolean when provided.");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    invalidOptions("Task discovery signal must be an AbortSignal when provided.");
  }

  const normalizedConfig = config as VeryfrontConfig | undefined;
  return {
    projectDir,
    adapter: adapter as RuntimeAdapter,
    config: normalizedConfig,
    tasksDir,
    debug,
    signal: signal as AbortSignal | undefined,
    fsType: readConfiguredFsType(normalizedConfig),
  };
}

function resolveTasksBaseDir(
  projectDir: string,
  tasksDir: string,
  fsType: TaskDiscoverySnapshot["fsType"],
): string {
  return fsType === "github" || fsType === "veryfront-api" ? tasksDir : join(projectDir, tasksDir);
}

function isPathWithin(root: string, target: string): boolean {
  const child = relative(root, target).replaceAll("\\", "/");
  return child === "" || child === "." ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith("../"));
}

function assertCanonicalPath(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_DIR_LENGTH ||
    value.includes("\0")
  ) {
    throw new TypeError("Task discovery received an invalid canonical path.");
  }
}

async function assertTasksBaseWithinProject(
  snapshot: TaskDiscoverySnapshot,
  baseDir: string,
): Promise<void> {
  if (snapshot.fsType === "github" || snapshot.fsType === "veryfront-api") return;

  const fs = snapshot.adapter.fs;
  if (typeof fs.realPath === "function") {
    const [canonicalProject, canonicalBase] = await Promise.all([
      fs.realPath.call(fs, snapshot.projectDir),
      fs.realPath.call(fs, baseDir),
    ]);
    assertCanonicalPath(canonicalProject);
    assertCanonicalPath(canonicalBase);
    if (!isPathWithin(canonicalProject, canonicalBase)) {
      throw new TypeError("Task directory resolves outside the project root.");
    }
    return;
  }

  if (typeof fs.lstat !== "function") return;
  let candidate = snapshot.projectDir;
  const rootInfo = await fs.lstat.call(fs, candidate);
  if (rootInfo.isSymlink) {
    throw new TypeError("Task directory containment cannot be verified.");
  }
  for (const segment of snapshot.tasksDir.split("/")) {
    candidate = join(candidate, segment);
    const info = await fs.lstat.call(fs, candidate);
    if (info.isSymlink) {
      throw new TypeError("Task directory resolves through a symbolic link.");
    }
  }
}

function sourcePathFor(filePath: string, baseDir: string, tasksDir: string): string {
  const childPath = relative(baseDir, filePath).replaceAll("\\", "/");
  if (
    childPath === "" || childPath === ".." || childPath.startsWith("../") ||
    isAbsolute(childPath) || hasUnsafeControlCharacters(childPath) ||
    childPath.includes("\u061C") ||
    childPath.length > MAX_PROJECT_DIR_LENGTH - tasksDir.length - 1
  ) {
    return tasksDir;
  }
  return `${tasksDir}/${childPath}`;
}

async function collectTaskFiles(
  baseDir: string,
  adapter: RuntimeAdapter,
  signal: AbortSignal | undefined,
): Promise<TaskFile[]> {
  const files: TaskFile[] = [];
  for await (
    const file of discoverFiles({
      baseDir,
      extensions: TASK_FILE_EXTENSIONS,
      recursive: true,
      ignorePatterns: TASK_IGNORE_PATTERNS,
      adapter,
    })
  ) {
    signal?.throwIfAborted();
    if (files.length >= MAX_TASK_FILES) {
      throw INITIALIZATION_ERROR.create({
        detail: `Task discovery supports at most ${MAX_TASK_FILES} files.`,
      });
    }
    files.push({ path: file.path });
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

function extractTaskExport(
  module: Record<string, unknown>,
): { exportName: string; definition: TaskDefinition } | null {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(module);
  } catch {
    return null;
  }
  if (keys.length > MAX_TASK_EXPORTS) {
    throw INITIALIZATION_ERROR.create({
      detail: `Task modules support at most ${MAX_TASK_EXPORTS} exports.`,
    });
  }
  for (const key of keys) {
    if (typeof key === "string") continue;
    try {
      if (Object.getOwnPropertyDescriptor(module, key)?.enumerable) return null;
    } catch {
      return null;
    }
  }

  const exportNames = keys.filter((key): key is string => typeof key === "string").sort();
  const orderedNames = exportNames.includes("default")
    ? ["default", ...exportNames.filter((name) => name !== "default")]
    : exportNames;
  for (const exportName of orderedNames) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(module, exportName);
    } catch {
      return null;
    }
    if (!descriptor || !("value" in descriptor)) continue;
    try {
      return {
        exportName,
        definition: normalizeTaskDefinition(descriptor.value),
      };
    } catch {
      if (hasTaskDefinitionRunMember(descriptor.value)) {
        throw INITIALIZATION_ERROR.create({
          detail: "Task module exports an invalid task definition.",
        });
      }
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
  let relative = filePath.replaceAll("\\", "/");
  const normalizedTasksDir = tasksDir.replaceAll("\\", "/").replace(/\/$/, "");
  const dirPrefix = `${normalizedTasksDir}/`;
  if (relative.startsWith(dirPrefix)) {
    relative = relative.slice(dirPrefix.length);
  }
  // Remove extension
  return relative.replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
}

/**
 * Discover all tasks in a project with the legacy file-based path.
 *
 * @deprecated Use `discoverProjectTaskRuntime` instead.
 */
export async function discoverTasks(
  options: TaskDiscoveryOptions,
): Promise<TaskDiscoveryResult> {
  const snapshot = snapshotDiscoveryOptions(options);
  const { projectDir, adapter, tasksDir, debug, signal, fsType } = snapshot;

  const tasks: DiscoveredTask[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  const baseDir = resolveTasksBaseDir(projectDir, tasksDir, fsType);
  const seenIds = new Set<string>();

  if (debug) {
    logger.info(`Scanning ${tasksDir} for tasks`);
  }

  try {
    signal?.throwIfAborted();
    const dirExists = await adapter.fs.exists.call(adapter.fs, baseDir);
    signal?.throwIfAborted();
    if (!dirExists) {
      if (debug) {
        logger.info(`No tasks directory found at ${tasksDir}`);
      }
      return { tasks, errors };
    }

    await assertTasksBaseWithinProject(snapshot, baseDir);
    signal?.throwIfAborted();

    const files = await collectTaskFiles(baseDir, adapter, signal);

    if (debug) {
      logger.info(`Found ${files.length} potential task files`);
    }

    for (const file of files) {
      signal?.throwIfAborted();
      const filePath = sourcePathFor(file.path, baseDir, tasksDir);
      const id = deriveTaskId(file.path, baseDir);
      if (!isCanonicalTaskId(id)) {
        errors.push({ filePath, error: "Task file must resolve to a canonical lowercase id." });
        continue;
      }
      try {
        const task = await loadTaskFromFile(
          file.path,
          id,
          adapter,
          projectDir,
        );
        if (task) {
          if (seenIds.has(task.id)) {
            errors.push({ filePath, error: `Duplicate task id "${task.id}".` });
            continue;
          }
          seenIds.add(task.id);
          task.filePath = filePath;
          tasks.push(task);
          logDiscoveredTask(task, debug);
        }
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
        errors.push({ filePath, error: "Unable to load task definition." });

        if (debug) {
          logger.warn(`Unable to load task definition from ${filePath}`);
        }
      }
    }

    if (debug) {
      logger.info(`Discovered ${tasks.length} tasks`);
    }

    return { tasks, errors };
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    logger.error("Task discovery failed");
    errors.push({ filePath: tasksDir, error: "Unable to discover task definitions." });
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
  normalizeTaskId(taskId);
  const snapshot = snapshotDiscoveryOptions(options);
  const { projectDir, adapter, tasksDir, debug, signal, fsType } = snapshot;
  const baseDir = resolveTasksBaseDir(projectDir, tasksDir, fsType);

  try {
    signal?.throwIfAborted();
    const dirExists = await adapter.fs.exists.call(adapter.fs, baseDir);
    signal?.throwIfAborted();
    if (!dirExists) return null;
    await assertTasksBaseWithinProject(snapshot, baseDir);
    signal?.throwIfAborted();

    const files = await collectTaskFiles(baseDir, adapter, signal);
    const matches = files.filter((file) => deriveTaskId(file.path, baseDir) === taskId);
    if (matches.length > 1) {
      throw INITIALIZATION_ERROR.create({ detail: `Duplicate task id "${taskId}".` });
    }

    for (const file of matches) {
      signal?.throwIfAborted();

      try {
        const task = await loadTaskFromFile(file.path, taskId, adapter, projectDir);
        if (task) {
          task.filePath = sourcePathFor(file.path, baseDir, tasksDir);
          logDiscoveredTask(task, debug);
          return task;
        }
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
        throw INITIALIZATION_ERROR.create({ detail: `Task "${taskId}" could not be loaded.` });
      }
    }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (error instanceof VeryfrontError) throw error;
    throw INITIALIZATION_ERROR.create({ detail: `Task "${taskId}" discovery failed.` });
  }

  return null;
}
