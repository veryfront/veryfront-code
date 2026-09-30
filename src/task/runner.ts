/**
 * Task Runner
 *
 * Executes a discovered task by calling its run() function
 * with the appropriate context.
 */

import { getErrorMessage } from "#veryfront/errors";
import { type HostRuntime, liveHostRuntime } from "#veryfront/platform/compat/process.ts";
import { buildTaskContextEnv } from "#veryfront/runs/runtime-env.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { isRetryableError } from "./errors.ts";
import {
  checkDeclaredSchema,
  createSchemaViolation,
  schemaIdentitySha256,
  type SchemaValidationError,
  type SchemaViolation,
} from "./io-contract.ts";
import type { TaskContext } from "./types.ts";
import type { TaskDefinition } from "./types.ts";

const logger = baseLogger.component("task-runner");
const INJECTED_TASK_ENV_JSON = "VERYFRONT_TASK_ENV_JSON";

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
  errorCode?: "INPUT_VALIDATION_FAILED";

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

/**
 * Run a task with the given options
 *
 * @param options Task definition and execution context.
 * @param host Host environment boundary. Omit it to use the current process.
 */
export async function runTask(
  options: RunTaskOptions,
  host: HostRuntime = liveHostRuntime(),
): Promise<TaskRunResult> {
  const {
    task,
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
  const hasInput = input !== undefined && input !== null;
  let schemaViolation: SchemaViolation | null = null;
  let inputSchemaSha256: string | null = null;
  let outputSchemaSha256: string | null = null;

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

    let taskInput: unknown = input ?? config;
    if (inputSchema !== undefined) {
      const check = await checkDeclaredSchema(inputSchema, taskInput);
      if (check.outcome === "invalid" && hasInput) {
        const durationMs = elapsedMilliseconds(start);
        logger.warn(`Task "${task.id}" input failed its inputSchema`, {
          taskId: task.id,
          errorCount: check.errors.length,
        });
        return {
          success: false,
          error: `Task "${task.id}" input failed inputSchema validation: ${
            check.errors.map((error) => `${error.path || "<root>"}: ${error.message}`).join("; ")
          }`,
          errorCode: "INPUT_VALIDATION_FAILED",
          errorDetail: { errors: check.errors },
          durationMs,
          ...identities,
          schemaViolation: null,
        };
      }
      if (check.outcome === "valid" && hasInput) taskInput = check.value;
      // Config-only runs keep reading config unchanged; a mismatch is only recorded.
      if (check.outcome !== "valid") {
        recordViolation(createSchemaViolation("input", check, inputSchemaSha256));
      }
    }

    const allEnv = host.env.toObject();
    assertInjectedTaskEnvIsValid(allEnv);
    const env = buildTaskContextEnv(allEnv, envAllowlist);
    const ctx: TaskContext = {
      env,
      config,
      input: taskInput,
      ...(runId === undefined ? {} : { runId }),
      projectId,
      environmentId,
      ...(signal === undefined ? {} : { signal }),
      attempt,
    };

    let result = await task.definition.run(ctx);
    if (outputSchema !== undefined) {
      const check = await checkDeclaredSchema(outputSchema, result);
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
    const errorMsg = getErrorMessage(error);

    logger.error(`Task "${task.id}" failed: ${errorMsg}`);

    return {
      success: false,
      error: errorMsg,
      durationMs,
      ...(isRetryableError(error) ? { retryable: true as const } : {}),
      inputSchemaSha256,
      outputSchemaSha256,
      schemaViolation,
    };
  }
}
