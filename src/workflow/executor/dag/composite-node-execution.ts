import { TIMEOUT_ERROR } from "#veryfront/errors";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import type { RetryConfig, WorkflowNode } from "../../types.ts";
import { parsePositiveDurationWithLabel, validateRetryConfig } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { sleep } from "#veryfront/utils";
import { createSetContextPatch } from "./context-patch.ts";
import { calculateRetryDelay, isRetryableWorkflowError } from "../retry-policy.ts";
import {
  getPrimaryAbortReason,
  isAbortCleanupError,
  isNonCooperativeOperationError,
  runAbortableOperation,
} from "../abortable-operation.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";

interface CompositeNodeExecutionInput {
  node: WorkflowNode;
  parentSignal?: AbortSignal;
  cancellationGracePeriod?: number;
  execute: (abortSignal: AbortSignal) => Promise<NodeExecutionResult>;
}

export async function executeCompositeNodeWithPolicy(
  input: CompositeNodeExecutionInput,
): Promise<NodeExecutionResult> {
  const { node, parentSignal, execute } = input;
  const retry = node.config.retry;
  if (retry !== undefined) validateRetryConfig(retry);

  const maxAttempts = retry?.maxAttempts ?? 1;
  const timeout = node.config.timeout === undefined ? undefined : parsePositiveDurationWithLabel(
    node.config.timeout,
    `Composite node "${node.id}" timeout`,
  );
  const startedAt = new Date();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    parentSignal?.throwIfAborted();

    try {
      const result = await runAbortableOperation(execute, {
        label: `Composite node "${node.id}"`,
        parentSignal,
        cancellationGracePeriod: input.cancellationGracePeriod,
        timeout: timeout === undefined ? undefined : {
          milliseconds: timeout,
          reason: TIMEOUT_ERROR.create({
            detail: `Composite node "${node.id}" timed out after ${timeout}ms`,
          }),
        },
      });
      const attemptedResult = withAttempt(result, attempt);

      if (attemptedResult.state.status !== "failed") return attemptedResult;

      const error = getExecutionFailure(attemptedResult) ??
        new Error(attemptedResult.state.error ?? `Composite node "${node.id}" failed`);
      if (attempt === maxAttempts || !isRetryableError(error, retry)) return attemptedResult;

      await sleep(calculateRetryDelay(attempt, retry), parentSignal);
    } catch (caught) {
      if (parentSignal?.aborted) {
        if (
          isAbortCleanupError(caught) &&
          Object.is(getPrimaryAbortReason(caught), parentSignal.reason)
        ) {
          throw caught;
        }
        parentSignal.throwIfAborted();
      }
      const error = ensureError(caught);

      if (attempt < maxAttempts && isRetryableError(error, retry)) {
        await sleep(calculateRetryDelay(attempt, retry), parentSignal);
        continue;
      }

      return retainExecutionFailure({
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
      }, error);
    }
  }

  throw new Error(`Composite node "${node.id}" exhausted its retry attempts`);
}

function withAttempt(result: NodeExecutionResult, attempt: number): NodeExecutionResult {
  return retainExecutionFailure({
    ...result,
    state: { ...result.state, attempt },
  }, getExecutionFailure(result));
}

function isRetryableError(error: Error, config: RetryConfig | undefined): boolean {
  if (isNonCooperativeOperationError(error)) return false;
  const classifiedError = isAbortCleanupError(error)
    ? ensureError(getPrimaryAbortReason(error))
    : error;
  return isRetryableWorkflowError(classifiedError, config);
}
