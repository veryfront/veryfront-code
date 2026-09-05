import { TIMEOUT_ERROR, VeryfrontError } from "#veryfront/errors";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { sleep } from "#veryfront/utils";
import {
  addActiveSpanEvent,
  setActiveSpanAttributes,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RetryConfig, WorkflowNode } from "../../types.ts";
import { parseDuration, validateRetryConfig } from "../../types.ts";
import {
  calculateRetryDelay,
  isRetryableWorkflowError,
  retryTelemetryErrorType,
} from "../retry-policy.ts";
import { createSetContextPatch } from "./context-patch.ts";
import type { NodeExecutionResult } from "./types.ts";

/**
 * An ownership-fenced write was refused: another worker owns the run row, so
 * this execution must stop writing instead of retrying or recording failure.
 */
export function isOwnershipLossError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { slug, context } = error as Error & {
    slug?: unknown;
    context?: { ownershipLost?: unknown };
  };
  return slug === "orchestration-error" && context?.ownershipLost === true;
}

const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;

interface CompositeNodeExecutionInput {
  node: WorkflowNode;
  parentSignal?: AbortSignal;
  cancellationGracePeriod?: number;
  execute: (abortSignal: AbortSignal) => Promise<NodeExecutionResult>;
}

const nonCooperativeErrors = new WeakSet<Error>();

/** Keeps a failed attempt visible: one node span otherwise hides every retry it contains. */
function recordCompositeRetry(
  nodeId: string,
  attempt: number,
  delayMs: number,
  error: Error,
): void {
  addActiveSpanEvent("workflow.node.retry", {
    "workflow.node.id": nodeId,
    "workflow.node.attempt": attempt,
    "workflow.node.retry_delay_ms": delayMs,
    "workflow.node.error_type": retryTelemetryErrorType(error),
  });
}

export async function executeCompositeNodeWithPolicy(
  input: CompositeNodeExecutionInput,
): Promise<NodeExecutionResult> {
  const { node, parentSignal, execute } = input;
  const retry = node.config.retry;
  if (retry) validateRetryConfig(retry);

  const maxAttempts = retry?.maxAttempts ?? 1;
  const timeout = node.config.timeout === undefined
    ? undefined
    : parseDuration(node.config.timeout);
  const startedAt = new Date();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    parentSignal?.throwIfAborted();

    try {
      const result = await executeAttempt(
        execute,
        node.id,
        timeout,
        parentSignal,
        input.cancellationGracePeriod,
      );
      const attemptedResult = withAttempt(result, attempt);

      if (attemptedResult.state.status !== "failed") {
        setActiveSpanAttributes({ "workflow.node.attempts": attempt });
        return attemptedResult;
      }

      const error = new Error(
        attemptedResult.state.error ?? `Composite node "${node.id}" failed`,
      );
      if (attempt === maxAttempts || !isRetryableError(error, retry)) {
        setActiveSpanAttributes({ "workflow.node.attempts": attempt });
        return attemptedResult;
      }

      // calculateRetryDelay applies random jitter, so it must be drawn once: calling it
      // again for telemetry would report a delay that was never slept.
      const delay = calculateRetryDelay(attempt, retry);
      recordCompositeRetry(node.id, attempt, delay, error);
      await sleep(delay, parentSignal);
    } catch (caught) {
      parentSignal?.throwIfAborted();
      // Ownership loss is not a composite failure: this worker must stop,
      // not retry children it no longer owns or record a failed state.
      if (isOwnershipLossError(caught)) throw caught;
      const error = ensureError(caught);

      if (attempt < maxAttempts && isRetryableError(error, retry)) {
        const delay = calculateRetryDelay(attempt, retry);
        recordCompositeRetry(node.id, attempt, delay, error);
        await sleep(delay, parentSignal);
        continue;
      }

      setActiveSpanAttributes({ "workflow.node.attempts": attempt });
      return {
        state: {
          nodeId: node.id,
          status: "failed",
          error: error.message,
          attempt,
          startedAt,
          completedAt: new Date(),
        },
        contextPatch: createSetContextPatch(),
        waiting: false,
        errorCause: error instanceof VeryfrontError ? error : undefined,
      };
    }
  }

  throw new Error(`Composite node "${node.id}" exhausted its retry attempts`);
}

async function executeAttempt(
  execute: (abortSignal: AbortSignal) => Promise<NodeExecutionResult>,
  nodeId: string,
  timeout: number | undefined,
  parentSignal: AbortSignal | undefined,
  cancellationGracePeriod: number | undefined,
): Promise<NodeExecutionResult> {
  const attemptController = new AbortController();
  const forwardAbort = () => attemptController.abort(parentSignal?.reason);
  if (parentSignal?.aborted) forwardAbort();
  else parentSignal?.addEventListener("abort", forwardAbort, { once: true });

  const operation = Promise.resolve().then(() => execute(attemptController.signal));
  const fencedOperation = operation.then((result) => {
    attemptController.signal.throwIfAborted();
    return result;
  });

  let rejectAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(attemptController.signal.reason);
    if (attemptController.signal.aborted) rejectAbort();
    else attemptController.signal.addEventListener("abort", rejectAbort, { once: true });
  });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeout !== undefined) {
    const timeoutError = TIMEOUT_ERROR.create({
      detail: `Composite node "${nodeId}" timed out after ${timeout}ms`,
    });
    timeoutId = setTimeout(() => attemptController.abort(timeoutError), timeout);
  }

  try {
    return await Promise.race([fencedOperation, abortPromise]);
  } catch (caught) {
    const error = ensureError(caught);
    if (attemptController.signal.aborted) {
      const settled = await waitForCancellationGrace(
        fencedOperation,
        cancellationGracePeriod,
      );
      if (!settled) nonCooperativeErrors.add(error);
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (rejectAbort) attemptController.signal.removeEventListener("abort", rejectAbort);
    parentSignal?.removeEventListener("abort", forwardAbort);
  }
}

async function waitForCancellationGrace(
  operation: Promise<unknown>,
  configuredGracePeriod: number | undefined,
): Promise<boolean> {
  const gracePeriod = Math.max(
    0,
    configuredGracePeriod ?? DEFAULT_CANCELLATION_GRACE_PERIOD_MS,
  );
  let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const settled = operation.then(
    () => true,
    () => true,
  );
  const graceExpired = new Promise<false>((resolve) => {
    graceTimeoutId = setTimeout(() => resolve(false), gracePeriod);
  });

  try {
    return await Promise.race([settled, graceExpired]);
  } finally {
    if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);
  }
}

function withAttempt(result: NodeExecutionResult, attempt: number): NodeExecutionResult {
  return {
    ...result,
    state: { ...result.state, attempt },
  };
}

function isRetryableError(error: Error, config: RetryConfig | undefined): boolean {
  if (nonCooperativeErrors.has(error)) return false;
  return isRetryableWorkflowError(error, config);
}
