import {
  discoverProjectAgentRuntime,
  type ProjectAgentRuntimeDiscovery,
} from "#veryfront/agent/project/agent-runtime.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { fromFileUrl, isAbsolute, relative } from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { normalizeTaskDefinition } from "./definition.ts";
import { isCanonicalTaskId } from "./id.ts";
import type { RunnableTask } from "./runner.ts";
import type { TaskDefinition } from "./types.ts";

const MAX_PROJECT_DIR_LENGTH = 4_096;
const MAX_CACHE_KEY_LENGTH = 1_024;
const MAX_DISCOVERY_ERRORS = 10_000;
const MAX_RUNTIME_TASKS = 10_000;
const MAX_RUNTIME_TASK_METADATA_NODES = 100_000;
const MAX_RUNTIME_TASK_METADATA_CODE_UNITS = 16 * 1_024 * 1_024;
const MAX_DISCOVERY_ERROR_LENGTH = 4_096;
const MAX_DISCOVERY_ERROR_INPUT_LENGTH = MAX_DISCOVERY_ERROR_LENGTH * 2;
const MAX_FORMATTED_DISCOVERY_ERRORS_LENGTH = 10_000;
const DISCOVERY_ERRORS_OMITTED_LINE = "<project>: Additional discovery errors were omitted.";

/** Options for discovering tasks through the complete project runtime. */
export interface ProjectTaskRuntimeOptions {
  /** Project root used for configuration and source discovery. */
  projectDir: string;
  /** Runtime adapter used for project access and module execution. */
  adapter: RuntimeAdapter;
  /** Resolved project configuration, or `null` to load it from the project. */
  config?: VeryfrontConfig | null;
  /** Optional project filesystem adapter used by discovery. */
  fsAdapter?: FileSystemAdapter;
  /** Stable cache identity for an adapter-backed project source. */
  cacheKey?: string;
  /** Enable sanitized diagnostic logging. */
  debug?: boolean;
  /** Throw one contained aggregate error when any project source fails. */
  throwOnErrors?: boolean;
}

/** Project task definitions required by task lookup and listing helpers. */
export interface ProjectTaskCollection {
  /** Task definitions keyed by canonical task ID. */
  tasks: ReadonlyMap<string, TaskDefinition>;
}

/** A contained source failure returned by project runtime discovery. */
export interface ProjectTaskDiscoveryError {
  /** Project-relative source location. */
  file: string;
  /** Source loading, validation, or registration failure. */
  error: Error;
}

interface ProjectTaskRuntimeSnapshot extends ProjectTaskRuntimeOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  debug: boolean;
  throwOnErrors: boolean;
}

interface TaskMetadataBudget {
  codeUnits: number;
  nodes: number;
}

function invalidOptions(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function hasUnsafeIdentityCharacters(value: string): boolean {
  return hasUnsafeControlCharacters(value) || value.includes("\u061C");
}

function readOwnOption(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    invalidOptions("Project task runtime options are required.");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      invalidOptions(`Project task runtime options.${key} must be a data property.`);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Project task runtime options could not be inspected safely.");
  }
}

function snapshotProjectTaskRuntimeOptions(
  value: ProjectTaskRuntimeOptions,
): ProjectTaskRuntimeSnapshot {
  const projectDir = readOwnOption(value, "projectDir");
  const adapter = readOwnOption(value, "adapter");
  const config = readOwnOption(value, "config");
  const fsAdapter = readOwnOption(value, "fsAdapter");
  const cacheKey = readOwnOption(value, "cacheKey");
  const debug = readOwnOption(value, "debug") ?? false;
  const throwOnErrors = readOwnOption(value, "throwOnErrors") ?? false;

  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > MAX_PROJECT_DIR_LENGTH ||
    hasUnsafeIdentityCharacters(projectDir)
  ) {
    invalidOptions("Project task runtime options.projectDir must be a bounded non-empty path.");
  }
  if (!adapter || typeof adapter !== "object") {
    invalidOptions("Project task runtime options.adapter is required.");
  }
  if (config !== undefined && config !== null && typeof config !== "object") {
    invalidOptions("Project task runtime options.config must be an object when provided.");
  }
  if (fsAdapter !== undefined && (!fsAdapter || typeof fsAdapter !== "object")) {
    invalidOptions("Project task runtime options.fsAdapter must be an object when provided.");
  }
  if (
    cacheKey !== undefined &&
    (typeof cacheKey !== "string" || cacheKey.length === 0 ||
      cacheKey.length > MAX_CACHE_KEY_LENGTH ||
      hasUnsafeIdentityCharacters(cacheKey))
  ) {
    invalidOptions("Project task runtime options.cacheKey must be a bounded non-empty string.");
  }
  if (typeof debug !== "boolean" || typeof throwOnErrors !== "boolean") {
    invalidOptions("Project task runtime debug flags must be booleans when provided.");
  }

  return {
    projectDir,
    adapter: adapter as RuntimeAdapter,
    ...(config === undefined ? {} : { config: config as VeryfrontConfig | null }),
    ...(fsAdapter === undefined ? {} : { fsAdapter: fsAdapter as FileSystemAdapter }),
    ...(cacheKey === undefined ? {} : { cacheKey: cacheKey as string }),
    debug,
    throwOnErrors,
  };
}

function readDiscoveryField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function projectRelativeFile(value: unknown, projectDir: string | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROJECT_DIR_LENGTH) {
    return "<project>";
  }
  let file = value;
  if (/^file:/i.test(file)) {
    try {
      file = fromFileUrl(file);
    } catch {
      return "<project>";
    }
  }
  if (hasUnsafeControlCharacters(file) || file.includes("\u061C")) return "<project>";
  const normalizedFile = file.replaceAll("\\", "/");
  if (!isAbsolute(normalizedFile)) {
    const segments = normalizedFile.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
      ? normalizedFile
      : "<project>";
  }
  if (!projectDir) {
    return "<project>";
  }
  let root = projectDir;
  if (/^file:/i.test(root)) {
    try {
      root = fromFileUrl(root);
    } catch {
      return "<project>";
    }
  }
  if (
    root.length === 0 || root.length > MAX_PROJECT_DIR_LENGTH ||
    hasUnsafeControlCharacters(root) || root.includes("\u061C")
  ) return "<project>";
  const child = relative(root, normalizedFile).replaceAll("\\", "/");
  return child !== "" && child !== "." && child !== ".." && !child.startsWith("../") &&
      !isAbsolute(child)
    ? child
    : "<project>";
}

function discoveryMessage(value: unknown): string {
  const message = readDiscoveryField(value, "message");
  if (typeof message !== "string" || message.length === 0) {
    return "Project source could not be loaded.";
  }
  return message.length <= MAX_DISCOVERY_ERROR_INPUT_LENGTH
    ? message
    : message.slice(0, MAX_DISCOVERY_ERROR_INPUT_LENGTH);
}

function accountRuntimeTaskMetadata(
  definition: TaskDefinition,
  budget: TaskMetadataBudget,
): void {
  const accountText = (value: string | undefined): void => {
    if (value === undefined) return;
    budget.codeUnits += value.length;
    if (budget.codeUnits > MAX_RUNTIME_TASK_METADATA_CODE_UNITS) {
      throw INITIALIZATION_ERROR.create({
        detail: "Project runtime task metadata exceeds the supported aggregate size.",
      });
    }
  };

  accountText(definition.name);
  accountText(definition.description);

  const pending: unknown[] = [];
  if (definition.inputSchema !== undefined) pending.push(definition.inputSchema);
  if (definition.outputSchema !== undefined) pending.push(definition.outputSchema);

  while (pending.length > 0) {
    const value = pending.pop();
    budget.nodes += 1;
    if (budget.nodes > MAX_RUNTIME_TASK_METADATA_NODES) {
      throw INITIALIZATION_ERROR.create({
        detail: "Project runtime task metadata exceeds the supported aggregate size.",
      });
    }
    if (typeof value === "string") {
      accountText(value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) pending.push(value[index]);
      continue;
    }
    for (const key of Object.keys(value)) {
      accountText(key);
      pending.push((value as Record<string, unknown>)[key]);
    }
  }
}

function formatRuntimeDiscoveryError(
  entry: unknown,
  projectDir: string | undefined,
): string {
  const rawFile = readDiscoveryField(entry, "file");
  const file = projectRelativeFile(rawFile, projectDir);
  const rawError = readDiscoveryField(entry, "error");
  let message = discoveryMessage(rawError).replaceAll("\u061C", "");
  if (
    typeof rawFile === "string" && rawFile.length > 0 &&
    rawFile.length <= MAX_PROJECT_DIR_LENGTH
  ) {
    message = message.replaceAll(rawFile, () => file);
  }
  if (
    typeof projectDir === "string" && projectDir.length > 1 &&
    projectDir.length <= MAX_PROJECT_DIR_LENGTH &&
    !hasUnsafeIdentityCharacters(projectDir)
  ) {
    const root = projectDir.startsWith("file://") ? projectDir.slice("file://".length) : projectDir;
    const normalizedRoot = root.replaceAll("\\", "/");
    if (isAbsolute(normalizedRoot) && normalizedRoot !== "/") {
      message = message.replaceAll(projectDir, () => "<project>");
      if (root !== projectDir) message = message.replaceAll(root, () => "<project>");
    }
  }
  message = sanitizeErrorText(message, MAX_DISCOVERY_ERROR_LENGTH);
  message = message.replaceAll("\n", " ").replaceAll("\r", " ").replaceAll("\t", " ").trim();
  const line = `${file}: ${message || "Project source could not be loaded."}`;
  return line.length <= MAX_DISCOVERY_ERROR_LENGTH
    ? line
    : `${line.slice(0, MAX_DISCOVERY_ERROR_LENGTH - 3)}...`;
}

/** Format project discovery failures as bounded project-relative lines. */
export function formatProjectRuntimeDiscoveryErrors(
  errors: readonly ProjectTaskDiscoveryError[],
  projectDir?: string,
): string[] {
  let length = 0;
  try {
    if (!Array.isArray(errors)) return ["<project>: Discovery returned an invalid error list."];
    const descriptor = Object.getOwnPropertyDescriptor(errors, "length");
    length = descriptor && "value" in descriptor && Number.isSafeInteger(descriptor.value) &&
        descriptor.value >= 0
      ? descriptor.value
      : 0;
  } catch {
    return ["<project>: Discovery returned an unreadable error list."];
  }

  const count = Math.min(length, MAX_DISCOVERY_ERRORS);
  const lines: string[] = [];
  let outputLength = 0;
  let omitted = length > count;
  for (let index = 0; index < count; index++) {
    let entry: unknown;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(errors, String(index));
      entry = descriptor && "value" in descriptor ? descriptor.value : undefined;
    } catch {
      entry = undefined;
    }
    const line = formatRuntimeDiscoveryError(entry, projectDir);
    const separatorLength = lines.length === 0 ? 0 : 1;
    const candidateLength = outputLength + separatorLength + line.length;
    const hasMoreErrors = index + 1 < length;
    const reservedMarkerLength = hasMoreErrors ? 1 + DISCOVERY_ERRORS_OMITTED_LINE.length : 0;
    if (
      candidateLength + reservedMarkerLength > MAX_FORMATTED_DISCOVERY_ERRORS_LENGTH
    ) {
      omitted = true;
      break;
    }
    lines.push(line);
    outputLength = candidateLength;
  }
  if (omitted) {
    lines.push(DISCOVERY_ERRORS_OMITTED_LINE);
  }
  return lines;
}

/** Discover tasks and related runtime primitives from one project source. */
export async function discoverProjectTaskRuntime(
  options: ProjectTaskRuntimeOptions,
): Promise<ProjectAgentRuntimeDiscovery> {
  const snapshot = snapshotProjectTaskRuntimeOptions(options);
  const discovery = await discoverProjectAgentRuntime({
    projectDir: snapshot.projectDir,
    adapter: snapshot.adapter,
    config: snapshot.config,
    fsAdapter: snapshot.fsAdapter,
    cacheKey: snapshot.cacheKey,
    verbose: snapshot.debug,
  });

  if (snapshot.throwOnErrors && discovery.errors.length > 0) {
    const lines = formatProjectRuntimeDiscoveryErrors(discovery.errors, snapshot.projectDir);
    throw INITIALIZATION_ERROR.create({
      detail: [
        `Runtime discovery failed with ${discovery.errors.length} errors:`,
        ...lines.map((line) => `- ${line}`),
      ].join("\n"),
    });
  }

  return discovery;
}

/** Find and detach one canonical task from project runtime discovery. */
export function findProjectRuntimeTask(
  discovery: ProjectTaskCollection,
  taskId: string,
): RunnableTask | null {
  if (!isCanonicalTaskId(taskId)) return null;
  const definition = discovery.tasks.get(taskId);
  if (definition === undefined && !discovery.tasks.has(taskId)) return null;

  let normalized: ReturnType<typeof normalizeTaskDefinition>;
  try {
    normalized = normalizeTaskDefinition(definition);
  } catch {
    throw INITIALIZATION_ERROR.create({
      detail: "Project runtime contains an invalid task definition.",
    });
  }

  return {
    id: taskId,
    name: normalized.name ?? taskId,
    definition: normalized,
  };
}

/** List detached canonical project tasks in stable ID order. */
export function listProjectRuntimeTasks(discovery: ProjectTaskCollection): RunnableTask[] {
  const tasks: RunnableTask[] = [];
  const metadataBudget: TaskMetadataBudget = { codeUnits: 0, nodes: 0 };
  let inspected = 0;
  for (const [id, definition] of discovery.tasks) {
    if (inspected >= MAX_RUNTIME_TASKS) {
      throw INITIALIZATION_ERROR.create({
        detail: `Project runtime contains more than ${MAX_RUNTIME_TASKS} tasks.`,
      });
    }
    inspected += 1;
    if (!isCanonicalTaskId(id)) {
      throw INITIALIZATION_ERROR.create({
        detail: "Project runtime contains an invalid task id.",
      });
    }
    let normalized: TaskDefinition;
    try {
      normalized = normalizeTaskDefinition(definition);
    } catch {
      throw INITIALIZATION_ERROR.create({
        detail: "Project runtime contains an invalid task definition.",
      });
    }
    accountRuntimeTaskMetadata(normalized, metadataBudget);
    tasks.push({ id, name: normalized.name ?? id, definition: normalized });
  }
  tasks.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return tasks;
}
