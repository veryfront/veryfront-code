import { TIMEOUT_ERROR } from "#veryfront/errors";
import { isVeryfrontError } from "#veryfront/errors/http-error.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import type { RetryConfig, WorkflowNode } from "../../types.ts";
import { parseDuration, validateRetryConfig } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { sleep } from "#veryfront/utils";
import { createSetContextPatch } from "./context-patch.ts";

const DEFAULT_RETRY_INITIAL_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODE_RE = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND)\b/;

interface CompositeNodeExecutionInput {
  node: WorkflowNode;
  parentSignal?: AbortSignal;
  cancellationGracePeriod?: number;
  execute: (abortSignal: AbortSignal) => Promise<NodeExecutionResult>;
}

const nonCooperativeErrors = new WeakSet<Error>();

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

      if (attemptedResult.state.status !== "failed") return attemptedResult;

      const error = new Error(
        attemptedResult.state.error ?? `Composite node "${node.id}" failed`,
      );
      if (attempt === maxAttempts || !isRetryableError(error, retry)) return attemptedResult;

      await sleep(calculateRetryDelay(attempt, retry), parentSignal);
    } catch (caught) {
      parentSignal?.throwIfAborted();
      const error = ensureError(caught);

      if (attempt < maxAttempts && isRetryableError(error, retry)) {
        await sleep(calculateRetryDelay(attempt, retry), parentSignal);
        continue;
      }

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
  if (config?.retryIf) return config.retryIf(error);
  if (isVeryfrontError(error)) return RETRYABLE_STATUSES.has(error.status);

  const code = (error as { code?: unknown }).code;
  const subject = typeof code === "string" ? code : error.message;
  return RETRYABLE_CODE_RE.test(subject);
}

function calculateRetryDelay(attempt: number, config: RetryConfig | undefined): number {
  const initialDelay = config?.initialDelay ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
  const maxDelay = config?.maxDelay ?? DEFAULT_RETRY_MAX_DELAY_MS;

  let baseDelay = initialDelay;
  if (config?.backoff === "exponential") baseDelay = initialDelay * Math.pow(2, attempt - 1);
  else if (config?.backoff === "linear") baseDelay = initialDelay * attempt;

  const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
  return Math.floor(Math.min(baseDelay + jitter, maxDelay));
}
