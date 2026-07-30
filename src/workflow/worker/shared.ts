import { env as getProcessEnv } from "#veryfront/compat/process.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { mergeInjectedWorkflowEnv } from "#veryfront/runs/runtime-env.ts";
import { WorkflowClient } from "../api/workflow-client.ts";
import {
  assertWorkflowWorkerId,
  hasLockSupport,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { StepExecutorConfig } from "../executor/step-executor.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { reconcileWorkflowRunControl } from "../runtime/workflow-run-control.ts";
import {
  type CapturedTenantContext,
  parsePositiveDurationWithLabel,
  type WorkflowRun,
} from "../types.ts";

const DYNAMIC_ENTRYPOINT_OPTION_KEYS: ReadonlySet<string> = new Set(["debug"]);

interface EntrypointLogger {
  error: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

interface EntrypointExitCodes {
  SUCCESS: number;
  WORKFLOW_FAILED: number;
}

type WorkflowRunEntrypointState = "ready" | "running" | "closing" | "closed";

/**
 * One-shot managed workflow entrypoint.
 *
 * Calling the handle starts its only run; concurrent or later invocations fail
 * closed. Invocation always joins cleanup of factory-owned resources before it
 * settles. `destroy()` may abandon a ready handle or join an active run before
 * cleanup, never closes resources underneath that run, and may be retried when
 * cleanup fails. When both execution and cleanup fail, invocation rejects with
 * an `AggregateError` that preserves both failures.
 */
export interface WorkflowRunEntrypoint {
  (): Promise<number>;
  /** Join an active invocation, then perform idempotent, retry-safe cleanup. */
  destroy(): Promise<void>;
}

/** Executor composition whose backend is borrowed and therefore never destroyed with it. */
export interface IsolatedWorkflowRuntime {
  readonly executor: WorkflowExecutor;
  /** Close the executor and approval manager while preserving the borrowed backend. */
  destroy(): Promise<void>;
}

/** Close an isolated runtime before, and only before, closing its owned backend. */
export async function destroyOwnedWorkflowRunEntrypointResources(
  backend: WorkflowBackend,
  runtime?: IsolatedWorkflowRuntime,
): Promise<void> {
  await runtime?.destroy();
  await backend.destroy();
}

function failEntrypointAdmission(detail: string, cause?: unknown): never {
  throw INVALID_ARGUMENT.create({ detail, ...(cause === undefined ? {} : { cause }) });
}

function assertPlainEntrypointRecord(value: object, label: string): void {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
  } catch (cause) {
    failEntrypointAdmission(`${label} could not be inspected`, cause);
  }
  if (prototype === null) return;
  if (isProxyWithoutHooks(prototype)) {
    failEntrypointAdmission(`${label} must not inherit from a Proxy`);
  }

  let parent: object | null;
  try {
    parent = Object.getPrototypeOf(prototype) as object | null;
  } catch (cause) {
    failEntrypointAdmission(`${label} prototype could not be inspected`, cause);
  }
  if (parent !== null) failEntrypointAdmission(`${label} must be a plain record`);
}

/**
 * Detach an exact public entrypoint record without evaluating caller hooks.
 * Only own enumerable data properties from the explicit allow-list survive.
 */
export function captureExactWorkflowEntrypointRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    failEntrypointAdmission(`${label} must be a non-Proxy plain record`);
  }
  assertPlainEntrypointRecord(value, label);

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    failEntrypointAdmission(`${label} could not be inspected`, cause);
  }
  if (keys.length > allowedKeys.size) {
    failEntrypointAdmission(`${label} contains unsupported fields`);
  }

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      failEntrypointAdmission(
        `${label} contains unsupported ${
          typeof key === "string" ? `field "${key}"` : "symbol field"
        }`,
      );
    }

    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (cause) {
      failEntrypointAdmission(`${label} field "${key}" could not be inspected`, cause);
    }
    if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
      failEntrypointAdmission(
        `${label} field "${key}" must be an enumerable own data property`,
      );
    }
    snapshot[key] = descriptor.value;
  }

  for (const key of requiredKeys) {
    if (!Object.hasOwn(snapshot, key)) {
      failEntrypointAdmission(`${label} must contain enumerable own data property "${key}"`);
    }
  }
  return Object.freeze(snapshot);
}

/** Capture and detach common factory options before resolving runtime providers. */
export function captureWorkflowRunEntrypointOptions(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string> = DYNAMIC_ENTRYPOINT_OPTION_KEYS,
  requiredKeys: readonly string[] = [],
): Readonly<{
  options: Readonly<Record<string, unknown>>;
  debug: boolean | undefined;
}> {
  if (
    typeof value !== "object" || value === null ||
    (!isProxyWithoutHooks(value) && Array.isArray(value))
  ) {
    failEntrypointAdmission(`${label} options must be an object`);
  }
  const options = captureExactWorkflowEntrypointRecord(
    value,
    `${label} options`,
    allowedKeys,
    requiredKeys,
  );
  const debug = options.debug;
  if (debug !== undefined && typeof debug !== "boolean") {
    failEntrypointAdmission(`${label} debug must be a boolean`);
  }

  return Object.freeze({
    options,
    debug,
  });
}

/** Preserve both an operation failure and its cleanup failure. */
export async function settleWorkflowEntrypointOperation<T>(
  operation: Promise<T>,
  cleanup: () => Promise<void>,
  aggregateMessage: string,
): Promise<T> {
  let operationFailed = false;
  let operationError: unknown;
  let value: T | undefined;
  try {
    value = await operation;
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }

  if (operationFailed && cleanupFailed) {
    throw new AggregateError([operationError, cleanupError], aggregateMessage);
  }
  if (operationFailed) throw operationError;
  if (cleanupFailed) throw cleanupError;
  return value as T;
}

/**
 * Wrap one managed run in a source-compatible callable lifecycle handle.
 * Cleanup waits for the raw run promise, not this wrapper, avoiding teardown
 * self-deadlock when destroy() races invocation completion.
 */
export function createWorkflowRunEntrypointHandle(
  execute: () => Promise<number>,
  destroyResources: () => Promise<void>,
): WorkflowRunEntrypoint {
  let state: WorkflowRunEntrypointState = "ready";
  let rawRunPromise: Promise<number> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let cleanupCompleted = false;

  const cleanup = (): Promise<void> => {
    if (cleanupPromise) return cleanupPromise;
    if (cleanupCompleted) return Promise.resolve();

    state = "closing";
    const attempt = Promise.resolve().then(destroyResources);
    cleanupPromise = attempt;
    attempt.then(
      () => {
        cleanupCompleted = true;
        state = "closed";
      },
      () => {
        if (cleanupPromise === attempt) cleanupPromise = undefined;
      },
    );
    return attempt;
  };

  const destroy = (): Promise<void> => {
    if (state === "ready" || state === "running") state = "closing";
    const activeRun = rawRunPromise;
    if (!activeRun) return cleanup();
    return activeRun.then(cleanup, cleanup);
  };

  const run = (): Promise<number> => {
    if (state !== "ready") {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({
          detail: `Cannot invoke workflow run entrypoint: it is ${state}`,
        }),
      );
    }

    state = "running";
    const admittedRun = Promise.withResolvers<number>();
    rawRunPromise = admittedRun.promise;
    try {
      admittedRun.resolve(execute());
    } catch (error) {
      admittedRun.reject(error);
    }
    return settleWorkflowEntrypointOperation(
      admittedRun.promise,
      cleanup,
      "Workflow run entrypoint execution and cleanup failed",
    );
  };

  return Object.assign(run, { destroy });
}

/** Return the immutable worker owner assigned to this isolated run execution. */
export function getRunExecutionWorkerId(): string {
  const executionId = getEnv("RUN_EXECUTION_ID");
  if (!executionId || executionId.trim() !== executionId) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Managed workflow execution requires a canonical RUN_EXECUTION_ID",
    });
  }
  const workerId = `run-execution:${executionId}`;
  assertWorkflowWorkerId(workerId);
  return workerId;
}

interface RunExecutionLockAcquisitionPolicy {
  duration: number;
  timeout: number;
  retryInterval: number;
}

export interface RunExecutionLockLease {
  readonly lockId: string;
  /** Stop and join the startup heartbeat before WorkflowExecutor adopts the lease. */
  stop(): Promise<void>;
}

function parseLockPolicyEnv(name: string): number {
  const raw = getEnv(name);
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Managed workflow execution requires a positive integer ${name}`,
    });
  }
  return parsePositiveDurationWithLabel(Number(raw), name);
}

function getRunExecutionLockAcquisitionPolicy(): RunExecutionLockAcquisitionPolicy {
  return {
    duration: parseLockPolicyEnv("WORKFLOW_LOCK_DURATION_MS"),
    timeout: parseLockPolicyEnv("WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS"),
    retryInterval: parseLockPolicyEnv("WORKFLOW_LOCK_RETRY_INTERVAL_MS"),
  };
}

/**
 * Acquire the isolated execution's own lease after its manager releases the
 * pending-claim lease. Every managed entrypoint mutation is fenced by the
 * returned token.
 */
export async function acquireRunExecutionLock(
  backend: WorkflowBackend,
  runId: string,
  expectedWorkerId: string,
): Promise<RunExecutionLockLease> {
  if (!hasLockSupport(backend)) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Managed workflow execution requires lock-capable backend support",
    });
  }

  const policy = getRunExecutionLockAcquisitionPolicy();
  const startedAt = Date.now();
  while (true) {
    const run = await backend.getRun(runId);
    if (!run || !["pending", "running", "waiting"].includes(run.status)) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot acquire execution lock for inactive workflow run "${runId}"`,
      });
    }
    if (run.workerId !== expectedWorkerId) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Cannot acquire execution lock after ownership changed for run "${runId}"`,
      });
    }

    const token = await backend.acquireLock(runId, policy.duration);
    if (token !== null) {
      if (typeof token !== "string" || token.trim().length === 0) {
        const invalidTokenError = ORCHESTRATION_ERROR.create({
          detail: `Workflow backend returned an invalid lock token for run "${runId}"`,
        });
        if (typeof token === "string") {
          await releaseUnadmittedRunExecutionLock(backend, runId, token, invalidTokenError);
        }
        throw invalidTokenError;
      }
      let admitted = false;
      try {
        admitted = await updateRunIfStatus(
          backend,
          runId,
          [run.status],
          { heartbeatAt: new Date() },
          expectedWorkerId,
          token,
        );
      } catch (error) {
        await releaseUnadmittedRunExecutionLock(backend, runId, token, error);
      }
      if (admitted) {
        let intervalId: ReturnType<typeof setInterval> | undefined;
        let heartbeatPromise: Promise<void> | undefined;
        let heartbeatError: Error | undefined;
        let stopped = false;
        const heartbeatInterval = Math.max(1, Math.floor(policy.duration / 3));

        intervalId = setInterval(() => {
          if (stopped || heartbeatPromise || heartbeatError) return;
          heartbeatPromise = (async () => {
            try {
              const extended = await backend.extendLock(runId, policy.duration, token);
              if (extended !== true) {
                throw ORCHESTRATION_ERROR.create({
                  detail: `Lost startup lock for workflow run "${runId}"`,
                });
              }
              const owned = await updateRunIfStatus(
                backend,
                runId,
                ["pending", "running", "waiting"],
                { heartbeatAt: new Date() },
                expectedWorkerId,
                token,
              );
              if (!owned) {
                throw ORCHESTRATION_ERROR.create({
                  detail: `Lost startup ownership for workflow run "${runId}"`,
                });
              }
            } catch (error) {
              heartbeatError = error instanceof Error
                ? error
                : ORCHESTRATION_ERROR.create({ detail: String(error) });
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = undefined;
              }
            } finally {
              heartbeatPromise = undefined;
            }
          })();
        }, heartbeatInterval);

        return {
          lockId: token,
          async stop(): Promise<void> {
            if (!stopped) {
              stopped = true;
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = undefined;
              }
              if (heartbeatPromise) await heartbeatPromise;
            }
            if (heartbeatError) throw heartbeatError;
          },
        };
      }
      const ownershipError = ORCHESTRATION_ERROR.create({
        detail: `Lost workflow ownership while acquiring execution lock for run "${runId}"`,
      });
      await releaseUnadmittedRunExecutionLock(backend, runId, token, ownershipError);
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= policy.timeout) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Timed out acquiring execution lock for workflow run "${runId}"`,
      });
    }
    const delay = Math.min(policy.retryInterval, policy.timeout - elapsed);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

async function releaseUnadmittedRunExecutionLock(
  backend: WorkflowBackend & Required<Pick<WorkflowBackend, "releaseLock">>,
  runId: string,
  token: string,
  primaryError: unknown,
): Promise<never> {
  try {
    const released = await backend.releaseLock(runId, token);
    if (typeof released !== "boolean") {
      throw ORCHESTRATION_ERROR.create({
        detail: `Workflow backend returned a non-boolean lock release result for run "${runId}"`,
      });
    }
    if (!released) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Could not release unadmitted execution lock for run "${runId}"`,
      });
    }
  } catch (cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `Execution lock admission and cleanup both failed for run "${runId}"`,
    );
  }
  throw primaryError;
}

/** Release only the exact startup lease still owned by this execution. */
export async function releaseRunExecutionLock(
  backend: WorkflowBackend,
  runId: string,
  lockId: string | undefined,
): Promise<void> {
  if (!lockId || !hasLockSupport(backend)) return;
  const released = await backend.releaseLock(runId, lockId);
  if (typeof released !== "boolean") {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow backend returned a non-boolean lock release result for run "${runId}"`,
    });
  }
}

/** Create an isolated borrowed-backend runtime with durable approval handling and no timer. */
export function createIsolatedWorkflowRuntime(
  backend: WorkflowBackend,
  debug = false,
  stepExecutor?: StepExecutorConfig,
): IsolatedWorkflowRuntime {
  const client = new WorkflowClient({
    backend,
    backendOwnership: "borrowed",
    debug,
    executor: stepExecutor ? { stepExecutor } : undefined,
    approval: { expirationCheckInterval: 0 },
  });
  const executor = client.getExecutor();
  return Object.freeze({
    executor,
    destroy: () => client.destroy(),
  });
}

export async function hydrateRunContextEnv(
  backend: WorkflowBackend,
  runId: string,
  run: WorkflowRun,
  expectedWorkerId?: string,
  expectedLockId?: string,
): Promise<WorkflowRun> {
  const injectedEnv = mergeInjectedWorkflowEnv(run.context.env, getProcessEnv());
  if (!injectedEnv) {
    return run;
  }

  const currentSerialized = run.context.env ? JSON.stringify(run.context.env) : "";
  const nextSerialized = JSON.stringify(injectedEnv);
  if (currentSerialized === nextSerialized) {
    return run;
  }

  const outcome = await reconcileWorkflowRunControl({
    backend,
    operation: {
      type: "hydrate-env",
      run,
      env: injectedEnv,
      expectedWorkerId,
      expectedLockId,
    },
  });
  if (outcome.status !== "reconciled" && outcome.status !== "unchanged") {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow environment hydration lost execution ownership for "${runId}"`,
    });
  }
  if (!outcome.run) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow environment hydration returned no run state for "${runId}"`,
    });
  }
  return outcome.run;
}

export function getFinalRunExitCode(
  logger: EntrypointLogger,
  exitCodes: EntrypointExitCodes,
  runId: string,
  finalRun: WorkflowRun | null,
  debug = false,
): number {
  switch (finalRun?.status) {
    case "completed":
      if (debug) {
        logger.info(`Workflow completed successfully: ${runId}`);
      }
      return exitCodes.SUCCESS;

    case "failed":
      logger.error(`Workflow failed: ${runId}`, finalRun.error);
      return exitCodes.WORKFLOW_FAILED;

    case "waiting":
      if (debug) {
        logger.info(`Workflow paused (waiting): ${runId}`);
      }
      return exitCodes.SUCCESS;

    case "cancelled":
      logger.warn(`Workflow was cancelled: ${runId}`);
      return exitCodes.WORKFLOW_FAILED;

    case "pending":
    case "running":
      logger.warn(`Workflow did not reach a durable final state: ${finalRun.status}`);
      return exitCodes.WORKFLOW_FAILED;

    default:
      logger.warn(
        finalRun
          ? `Unexpected final status: ${finalRun.status}`
          : `Workflow run was not found after execution: ${runId}`,
      );
      return exitCodes.WORKFLOW_FAILED;
  }
}

export async function failRunExecution(
  backend: WorkflowBackend,
  logger: EntrypointLogger,
  exitCodes: EntrypointExitCodes,
  runId: string,
  error: unknown,
  expectedWorkerId?: string,
  expectedLockId?: string,
): Promise<number> {
  logger.error("Execution error:", error);

  await reconcileWorkflowRunControl({
    backend,
    operation: {
      type: "fail-execution",
      runId,
      error,
      expectedWorkerId,
      expectedLockId,
    },
  });

  return exitCodes.WORKFLOW_FAILED;
}

export function runWithTenantContext<T>(
  tenant: CapturedTenantContext,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithRequestContext(
    {
      projectSlug: tenant.projectSlug,
      token: tenant.token,
      projectId: tenant.projectId,
      productionMode: tenant.productionMode,
      releaseId: tenant.releaseId,
      branch: tenant.branch,
      environmentName: tenant.environmentName,
    },
    fn,
  );
}
