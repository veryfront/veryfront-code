/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { getErrorMessage } from "#veryfront/errors";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import { type HostRuntime, liveHostRuntime } from "#veryfront/platform/compat/process.ts";
import { buildTaskContextEnv } from "#veryfront/runs/runtime-env.ts";
import {
  formatSchemaValidationErrors,
  INPUT_VALIDATION_FAILED_CODE,
} from "#veryfront/schemas/validation-errors.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { isRetryableError } from "./errors.ts";
import {
  checkDeclaredSchema,
  createSchemaViolation,
  type SchemaCheck,
  schemaIdentitySha256,
  type SchemaValidationError,
  type SchemaViolation,
} from "./io-contract.ts";
import type { TaskContext } from "./types.ts";
import type { TaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-runner");
const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

/** A task wrote outside `ctx.dataDir` on a runtime whose project filesystem is read-only. */
export const TASK_FILESYSTEM_READ_ONLY_CODE = "TASK_FILESYSTEM_READ_ONLY";
/** A task threw an error that no more specific code describes. */
export const TASK_EXECUTION_FAILED_CODE = "TASK_EXECUTION_FAILED";

const READ_ONLY_FS_HINT =
  "The project filesystem is read-only in hosted runtimes; write scratch files under ctx.dataDir instead.";

const TASK_DATA_DIR_PLACEHOLDER = "<task data dir>";
// Task code shares this process and may replace built-ins before it fails.
const reflectApply = Reflect.apply;
const ownPropertyDescriptor = Object.getOwnPropertyDescriptor;
// `test` and `replaceAll` dispatch through `exec` and `Symbol.replace`; these do not.
const regExpExec = RegExp.prototype.exec;
const stringIndexOf = String.prototype.indexOf;
const stringSlice = String.prototype.slice;
const stringLastIndexOf = String.prototype.lastIndexOf;
const TASK_DATA_DIR_PREFIX = "veryfront-task-";
const READ_ONLY_FS_PATTERN = /\(os error 30\)|\bEROFS\b|read-only file system/i;

/** An own data property of a thrown value; an accessor or a hostile object yields nothing. */
function ownErrorField(error: unknown, key: "code" | "message"): unknown {
  try {
    if (error === null || typeof error !== "object") return undefined;
    const descriptor = reflectApply(ownPropertyDescriptor, Object, [error, key]) as
      | PropertyDescriptor
      | undefined;
    return descriptor?.value;
  } catch {
    return undefined;
  }
}

function isTaskDataDirPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const slash = reflectApply(stringLastIndexOf, path, ["/"]) as number;
  const backslash = reflectApply(stringLastIndexOf, path, ["\\"]) as number;
  const name = reflectApply(stringSlice, path, [
    (slash > backslash ? slash : backslash) + 1,
  ]) as string;
  return reflectApply(stringIndexOf, name, [TASK_DATA_DIR_PREFIX]) === 0 &&
    name.length > TASK_DATA_DIR_PREFIX.length;
}

function isReadOnlyFilesystemError(error: unknown): boolean {
  if (ownErrorField(error, "code") === "EROFS") return true;
  const message = ownErrorField(error, "message");
  return typeof message === "string" &&
    reflectApply(regExpExec, READ_ONLY_FS_PATTERN, [message]) !== null;
}

function replaceAllLiteral(text: string, search: string, replacement: string): string {
  let result = "";
  let from = 0;
  for (;;) {
    const at = reflectApply(stringIndexOf, text, [search, from]) as number;
    if (at === -1) break;
    result += (reflectApply(stringSlice, text, [from, at]) as string) + replacement;
    from = at + search.length;
  }
  return result + (reflectApply(stringSlice, text, [from]) as string);
}

/** The failure text for a result or a log line, without the run's scratch directory path. */
function describeTaskFailure(error: unknown, dataDir: string | undefined): string {
  const message = getErrorMessage(error);
  if (dataDir === undefined || dataDir === "") return message;
  // The temp root can be reached through a symlinked prefix, as on macOS. Two direct calls
  // rather than a loop, since array iteration dispatches through a replaceable hook.
  const unprefixed = replaceAllLiteral(message, `/private${dataDir}`, TASK_DATA_DIR_PLACEHOLDER);
  return replaceAllLiteral(unprefixed, dataDir, TASK_DATA_DIR_PLACEHOLDER);
}

/** Creates and removes the per-run `ctx.dataDir`. */
export interface TaskScratchFs {
  makeTempDir(options: { prefix: string }): Promise<string>;
  remove(path: string, options: { recursive: boolean }): Promise<void>;
}

const liveScratchFs: TaskScratchFs = { makeTempDir, remove };

/**
 * A process without temp-write access still runs tasks that need no scratch space, so a
 * creation failure leaves `ctx.dataDir` unset. Only the error code is logged: native mkdtemp
 * messages name the host temp root.
 */
async function createTaskDataDir(scratchFs: TaskScratchFs): Promise<string | undefined> {
  let created: unknown;
  try {
    created = await scratchFs.makeTempDir({ prefix: TASK_DATA_DIR_PREFIX });
  } catch (error) {
    logger.warn("Task data directory could not be created; ctx.dataDir is unset", {
      code: ownErrorField(error, "code"),
    });
    return undefined;
  }
  // Task modules load before this runs and can replace the platform's mkdtemp. The directory is
  // removed recursively afterwards, so accept only a path whose last segment carries our prefix.
  if (!isTaskDataDirPath(created)) {
    logger.warn("Task data directory creation returned an unexpected path; ctx.dataDir is unset");
    return undefined;
  }
  return created;
}

export interface RunnableTask {
  /** Stable task id used by CLI, triggers, and cloud runs. */
  id: string;

  /** Human-readable task name. */
  name: string;

  /** The task definition to execute. */
  definition: TaskDefinition;
}

/**
 * Options for running a task
 */
export interface RunTaskOptions {
  /** Trusted platform capability; local Task contexts omit it. */
  runChild?: TaskContext["runChild"];

  /** The discovered task to run */
  task: RunnableTask;

  /** Additional config to pass to the task */
  config?: Record<string, unknown>;

  /** Business input for `ctx.input`. When omitted or `null`, `ctx.input` falls back to `config`. */
  input?: unknown;

  /** Public run ID (for cloud context) */
  runId?: string;

  /** Project ID (for cloud context) */
  projectId?: string;

  /** Environment ID for the runtime target executing this task */
  environmentId?: string;

  /** Cooperative cancellation propagated to the task context */
  signal?: AbortSignal;

  /** 1-based attempt number exposed as `ctx.attempt`. Defaults to 1. */
  attempt?: number;

  /** If set, only these env var names are passed to the task. */
  envAllowlist?: string[];

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of running a task
 */
export interface TaskRunResult {
  /** Whether the task completed successfully */
  success: boolean;

  /** Return value from the task's run() */
  result?: unknown;

  /** Error if the task failed */
  error?: string;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Set when the task threw a `RetryableError`: the platform may run it again. */
  retryable?: true;

  /** Machine-readable failure code, such as `INPUT_VALIDATION_FAILED`. */
  errorCode?:
    | typeof INPUT_VALIDATION_FAILED_CODE
    | typeof TASK_FILESYSTEM_READ_ONLY_CODE
    | typeof TASK_EXECUTION_FAILED_CODE;

  /** Validation errors for an `INPUT_VALIDATION_FAILED` failure. */
  errorDetail?: { errors: SchemaValidationError[] };

  /** Identity of the declared input schema, or `null` when none is declared. */
  inputSchemaSha256?: string | null;

  /** Identity of the declared output schema, or `null` when none is declared. */
  outputSchemaSha256?: string | null;

  /**
   * A recorded, non-fatal schema mismatch (warning phase). `null` when every declared schema
   * was enforced and matched.
   */
  schemaViolation?: SchemaViolation | null;
}

function elapsedMilliseconds(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function assertInjectedTaskEnvIsValid(allEnv: Record<string, string>): void {
  const serialized = allEnv[INJECTED_TASK_ENV_JSON];
  if (!serialized) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`, { cause });
  }
  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new TypeError(`${INJECTED_TASK_ENV_JSON} must contain a JSON object`);
  }
}

type FailedSchemaCheck = Exclude<SchemaCheck, { outcome: "valid" }>;

type TaskInputResolution =
  | { kind: "rejected"; errors: SchemaValidationError[] }
  | { kind: "resolved"; value: unknown; check: FailedSchemaCheck | null };

/**
 * Resolve the value passed to `run()` as `ctx.input`. Submitted input that
 * violates the declared inputSchema is rejected; config-only runs fall back to
 * `config` unchanged and return the failed check so it can be recorded.
 */
async function resolveTaskInput(
  inputSchema: unknown,
  input: unknown,
  config: unknown,
): Promise<TaskInputResolution> {
  const hasInput = input !== undefined && input !== null;
  const value = hasInput ? input : config;
  if (inputSchema === undefined) return { kind: "resolved", value, check: null };
  const check = await checkDeclaredSchema(inputSchema, value);
  if (check.outcome === "valid") {
    return { kind: "resolved", value: hasInput ? check.value : value, check: null };
  }
  if (check.outcome === "invalid" && hasInput) return { kind: "rejected", errors: check.errors };
  return { kind: "resolved", value, check };
}

/**
 * Run a task with the given options
 *
 * @param options Task definition and execution context.
 * @param host Host environment boundary. Omit it to use the current process.
 */
export async function runTask(
  options: RunTaskOptions,
  host: HostRuntime = liveHostRuntime(),
  scratchFs: TaskScratchFs = liveScratchFs,
): Promise<TaskRunResult> {
  const {
    task,
    runChild,
    config = {},
    input,
    runId,
    projectId,
    environmentId,
    signal,
    attempt = 1,
    envAllowlist,
    debug = false,
  } = options;
  const start = performance.now();
  const { inputSchema, outputSchema } = task.definition;
  let schemaViolation: SchemaViolation | null = null;
  let inputSchemaSha256: string | null = null;
  let outputSchemaSha256: string | null = null;
  let dataDir: string | undefined;

  const recordViolation = (violation: SchemaViolation): void => {
    // One record per run: the first mismatch detected wins.
    if (schemaViolation) return;
    schemaViolation = violation;
    logger.warn("Task schema violation recorded", {
      runId: runId ?? null,
      target: `task:${task.id}`,
      phase: violation.phase,
      reason: violation.reason,
    });
  };

  try {
    signal?.throwIfAborted();

    if (debug) {
      logger.info(`Running task "${task.id}" (${task.name})`);
    }

    inputSchemaSha256 = await schemaIdentitySha256(inputSchema);
    outputSchemaSha256 = await schemaIdentitySha256(outputSchema);
    const identities = { inputSchemaSha256, outputSchemaSha256 };

    const inputCheck = await resolveTaskInput(inputSchema, input, config);
    if (inputCheck.kind === "rejected") {
      logger.warn(`Task "${task.id}" input failed its inputSchema`, {
        taskId: task.id,
        errorCount: inputCheck.errors.length,
      });
      return {
        success: false,
        error: `Task "${task.id}" input failed inputSchema validation: ${
          formatSchemaValidationErrors(inputCheck.errors)
        }`,
        errorCode: INPUT_VALIDATION_FAILED_CODE,
        errorDetail: { errors: inputCheck.errors },
        durationMs: elapsedMilliseconds(start),
        ...identities,
        schemaViolation: null,
      };
    }
    const taskInput = inputCheck.value;
    // Config-only runs keep reading config unchanged; a mismatch is only recorded.
    if (inputCheck.check) {
      recordViolation(createSchemaViolation("input", inputCheck.check, inputSchemaSha256));
    }

    const allEnv = host.env.toObject();
    assertInjectedTaskEnvIsValid(allEnv);
    const env = buildTaskContextEnv(allEnv, envAllowlist);
    dataDir = await createTaskDataDir(scratchFs);
    const ctx: TaskContext = {
      ...(runChild === undefined ? {} : { runChild }),
      env,
      config,
      input: taskInput,
      ...(runId === undefined ? {} : { runId }),
      projectId,
      environmentId,
      ...(signal === undefined ? {} : { signal }),
      attempt,
      ...(dataDir === undefined ? {} : { dataDir }),
    };

    // Schema identity and input validation await; a cancel in that window must not start the task.
    signal?.throwIfAborted();
    let result = await task.definition.run(ctx);
    if (outputSchema !== undefined) {
      let check: Awaited<ReturnType<typeof checkDeclaredSchema>>;
      try {
        check = await checkDeclaredSchema(outputSchema, result);
      } catch {
        // Task code may have replaced built-ins the validator relies on. The task already ran,
        // so the warning phase records the output schema as unenforced instead of failing.
        check = { outcome: "schema_uncompilable" };
      }
      if (check.outcome === "valid") {
        result = check.value;
      } else {
        // Warning phase: the returned value is kept unchanged and the mismatch is recorded.
        recordViolation(createSchemaViolation("output", check, outputSchemaSha256));
      }
    }
    const durationMs = elapsedMilliseconds(start);

    if (debug) {
      logger.info(`Task "${task.id}" completed in ${durationMs}ms`);
    }

    return { success: true, result, durationMs, ...identities, schemaViolation };
  } catch (error) {
    const durationMs = elapsedMilliseconds(start);
    const readOnly = isReadOnlyFilesystemError(error);
    const failure = describeTaskFailure(error, dataDir);
    const errorMsg = readOnly ? `${failure}. ${READ_ONLY_FS_HINT}` : failure;

    logger.error(`Task "${task.id}" failed: ${errorMsg}`);

    return {
      success: false,
      error: errorMsg,
      errorCode: readOnly ? TASK_FILESYSTEM_READ_ONLY_CODE : TASK_EXECUTION_FAILED_CODE,
      durationMs,
      ...(isRetryableError(error) ? { retryable: true as const } : {}),
      inputSchemaSha256,
      outputSchemaSha256,
      schemaViolation,
    };
  } finally {
    if (dataDir !== undefined) {
      // Awaited in a try block rather than through the promise's own methods, which task
      // code may have replaced.
      try {
        await scratchFs.remove(dataDir, { recursive: true });
      } catch (error) {
        logger.warn("Task data directory cleanup failed", {
          target: `task:${task.id}`,
          error: describeTaskFailure(error, dataDir),
        });
      }
    }
  }
}
