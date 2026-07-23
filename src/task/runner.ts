/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { env as getProcessEnv } from "#veryfront/compat/process.ts";
import { buildTaskContextEnv } from "#veryfront/runs/runtime-env.ts";
import { normalizeTaskDefinition, snapshotTaskJsonObject } from "./definition.ts";
import { normalizeTaskId } from "./id.ts";
import type { TaskContext, TaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-runner");
const MAX_TASK_NAME_LENGTH = 255;
const MAX_CONTEXT_ID_LENGTH = 1_024;
const MAX_ENV_ALLOWLIST_ENTRIES = 10_000;
const MAX_TASK_ERROR_LENGTH = 4_096;

/** A validated task selected for execution. */
export interface RunnableTask {
  /** Stable task id used by CLI, triggers, and cloud runs. */
  id: string;

  /** Human-readable task name. */
  name: string;

  /** The task definition to execute. */
  definition: TaskDefinition;
}

/** Options for running one task invocation. */
export interface RunTaskOptions {
  /** Validated discovered task to run. */
  task: RunnableTask;

  /** JSON configuration copied into a private mutable task snapshot. */
  config?: Record<string, unknown>;

  /** Project identifier exposed to the task when supplied. */
  projectId?: string;

  /** Environment identifier exposed to the task when supplied. */
  environmentId?: string;

  /** If set, only these env var names are passed to the task. */
  envAllowlist?: string[];

  /** Enable sanitized diagnostic logging. */
  debug?: boolean;
}

/** Result returned after task execution settles. */
export interface TaskRunResult {
  /** Whether the task completed successfully. */
  success: boolean;

  /** Value returned by the task's `run` function. */
  result?: unknown;

  /** Bounded redacted error message when the task failed. */
  error?: string;

  /** Monotonic execution duration in milliseconds. */
  durationMs: number;
}

interface NormalizedRunTaskOptions {
  task: RunnableTask;
  config: Record<string, unknown>;
  projectId?: string;
  environmentId?: string;
  envAllowlist?: string[];
  debug: boolean;
}

function invalidOptions(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function readOwnOption(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") invalidOptions("Task run options are required.");
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      invalidOptions(`Task run options.${key} must be a data property.`);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Task run options could not be inspected safely.");
  }
}

function readOwnTaskProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidOptions("Task run options.task must be an object.");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      invalidOptions(`Task run options.task.${key} must be a data property.`);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Task run options.task could not be inspected safely.");
  }
}

function normalizeTaskName(value: unknown, fallback: string): string {
  const name = value === undefined ? fallback : value;
  if (
    typeof name !== "string" || name.length === 0 || name.length > MAX_TASK_NAME_LENGTH ||
    name.trim().length === 0
  ) {
    invalidOptions(`Task name must contain 1 to ${MAX_TASK_NAME_LENGTH} characters.`);
  }
  if (hasUnsafeControlCharacters(name) || name.includes("\u061C")) {
    invalidOptions("Task name contains control characters.");
  }
  return name;
}

function normalizeContextId(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_CONTEXT_ID_LENGTH ||
    hasUnsafeControlCharacters(value) || value.includes("\u061C")
  ) {
    invalidOptions(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function snapshotEnvAllowlist(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidOptions("Task envAllowlist could not be inspected safely.");
  }
  if (!isArray) invalidOptions("Task envAllowlist must be an array.");
  const array = value as unknown[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
  } catch {
    invalidOptions("Task envAllowlist could not be inspected safely.");
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_ENV_ALLOWLIST_ENTRIES
  ) {
    invalidOptions(`Task envAllowlist must contain at most ${MAX_ENV_ALLOWLIST_ENTRIES} entries.`);
  }
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(array);
  } catch {
    invalidOptions("Task envAllowlist could not be inspected safely.");
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      invalidOptions("Task envAllowlist must not contain extra properties.");
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
      invalidOptions("Task envAllowlist must not contain extra properties.");
    }
  }
  const snapshot = new Array<string>(length);
  for (let index = 0; index < length; index++) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    } catch {
      invalidOptions("Task envAllowlist could not be inspected safely.");
    }
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      invalidOptions("Task envAllowlist must be dense and contain only string data properties.");
    }
    snapshot[index] = descriptor.value;
  }
  return snapshot;
}

function snapshotRunOptions(value: RunTaskOptions): NormalizedRunTaskOptions {
  const rawTask = readOwnOption(value, "task");
  const id = normalizeTaskId(readOwnTaskProperty(rawTask, "id"));
  const name = normalizeTaskName(readOwnTaskProperty(rawTask, "name"), id);
  const rawDefinition = readOwnTaskProperty(rawTask, "definition");
  let definition: TaskDefinition;
  try {
    definition = normalizeTaskDefinition(rawDefinition);
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Task definition is invalid.");
  }

  const providedConfig = readOwnOption(value, "config");
  const rawConfig = providedConfig === undefined ? {} : providedConfig;
  const config = snapshotTaskJsonObject(rawConfig, "Task config", false);
  const projectId = normalizeContextId(readOwnOption(value, "projectId"), "Task projectId");
  const environmentId = normalizeContextId(
    readOwnOption(value, "environmentId"),
    "Task environmentId",
  );
  const envAllowlist = snapshotEnvAllowlist(readOwnOption(value, "envAllowlist"));
  const debug = readOwnOption(value, "debug") ?? false;
  if (typeof debug !== "boolean") invalidOptions("Task debug must be a boolean when provided.");

  return {
    task: { id, name, definition },
    config,
    ...(projectId === undefined ? {} : { projectId }),
    ...(environmentId === undefined ? {} : { environmentId }),
    ...(envAllowlist === undefined ? {} : { envAllowlist }),
    debug,
  };
}

function durationSince(start: number): number {
  const duration = performance.now() - start;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function taskFailureMessage(error: unknown): string {
  let message = "Task execution failed.";
  if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, "message");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
        message = descriptor.value;
      }
    } catch {
      return message;
    }
  }

  const sanitized = sanitizeErrorText(message, MAX_TASK_ERROR_LENGTH)
    .replaceAll("\u061C", "")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("\t", " ")
    .trim();
  if (sanitized.length === 0) return "Task execution failed.";
  return sanitized.length <= MAX_TASK_ERROR_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_TASK_ERROR_LENGTH - 3)}...`;
}

async function runTaskWithEnvironmentSource(
  options: RunTaskOptions,
  readEnvironment: () => Record<string, string>,
): Promise<TaskRunResult> {
  const { task, config, projectId, environmentId, envAllowlist, debug } = snapshotRunOptions(
    options,
  );
  const start = performance.now();

  if (debug) {
    logger.info(`Running task "${task.id}" (${task.name})`);
  }

  const allEnv = readEnvironment();
  const env = buildTaskContextEnv(allEnv, envAllowlist);

  const ctx: TaskContext = {
    env,
    config,
    projectId,
    environmentId,
  };

  try {
    const result = await task.definition.run(ctx);
    const durationMs = durationSince(start);

    if (debug) {
      logger.info(`Task "${task.id}" completed in ${durationMs}ms`);
    }

    return { success: true, result, durationMs };
  } catch (error) {
    const durationMs = durationSince(start);
    const errorMsg = taskFailureMessage(error);

    logger.error(`Task "${task.id}" failed`);

    return { success: false, error: errorMsg, durationMs };
  }
}

/** Validate the invocation and run a task with an isolated context. */
export async function runTask(options: RunTaskOptions): Promise<TaskRunResult> {
  return await runTaskWithEnvironmentSource(options, getProcessEnv);
}

/**
 * Run a task against an explicit runtime environment snapshot.
 *
 * Isolation workers use this entrypoint because scoped Deno env permissions
 * intentionally prohibit enumerating the host process environment.
 *
 * @internal
 */
export async function runTaskWithRuntimeEnvironment(
  options: RunTaskOptions,
  environment: Record<string, string>,
): Promise<TaskRunResult> {
  return await runTaskWithEnvironmentSource(options, () => environment);
}
