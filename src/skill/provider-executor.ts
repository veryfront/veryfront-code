/**
 * Runtime composition for extension-owned Skill script execution.
 *
 * Provider resolution is deliberately late-bound per execution. Once selected,
 * one validated provider snapshot owns that execution until both its result and
 * terminal cleanup settlement have been consumed.
 */

import {
  acquireContractLease,
  type ContractReference,
  trySnapshotContractForUse,
} from "../extensions/contract-registry-internal.ts";
import {
  observeSkillScriptExecutionSettlementWithoutHooks,
  requestSkillScriptExecutionTermination,
  SkillScriptExecutorProviderName,
  type SkillScriptExecutorProviderSnapshot,
  snapshotSkillScriptExecutorProvider,
} from "#veryfront/extensions/skill/script-executor-provider.ts";
import {
  addAbortSignalListenerOnce,
  removeAbortSignalListener,
} from "#veryfront/platform/compat/abort-signal.ts";
import { createIntrinsicPromiseContinuation } from "../extensions/promise-intrinsics-internal.ts";
import { getSkillScriptExecutor } from "./executor.ts";
import { type SkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";

const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const arrayIterator = Array.prototype[arrayIteratorSymbol];
const clearScheduledTimeout = clearTimeout;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const NativeAggregateError = AggregateError;
const scheduleTimeout = setTimeout;

/** A legacy/built-in executor or one snapshotted extension provider. */
export type SkillScriptExecutionBackend =
  | {
    readonly kind: "executor";
    readonly executor: SkillScriptExecutor;
  }
  | {
    readonly kind: "provider";
    readonly provider: Readonly<SkillScriptExecutorProviderSnapshot>;
    readonly contractReference: Readonly<ContractReference<unknown>>;
  };

function appendUniqueFailure(failures: unknown[], failure: unknown): void {
  for (let index = 0; index < failures.length; index += 1) {
    if (failures[index] === failure) return;
  }
  defineOwnProperty(failures, failures.length, {
    configurable: true,
    enumerable: true,
    value: failure,
    writable: true,
  });
}

function throwExecutionFailures(failures: unknown[]): never {
  if (failures.length === 1) throw failures[0];
  defineOwnProperty(failures, arrayIteratorSymbol, {
    configurable: false,
    enumerable: false,
    value: arrayIterator,
    writable: false,
  });
  throw new NativeAggregateError(
    failures,
    "Skill script execution and terminal cleanup failed",
  );
}

/**
 * Select a backend for one execution.
 *
 * Explicit executors are never inspected through the extension registry. A
 * present but malformed registration fails closed instead of falling back to a
 * built-in executor.
 */
export function resolveSkillScriptExecutionBackend(
  explicitExecutor?: SkillScriptExecutor,
): Readonly<SkillScriptExecutionBackend> {
  if (explicitExecutor !== undefined) {
    return freeze({ kind: "executor", executor: explicitExecutor });
  }

  const registered = trySnapshotContractForUse<unknown>(
    SkillScriptExecutorProviderName,
  );
  if (registered !== undefined) {
    return freeze({
      kind: "provider",
      provider: snapshotSkillScriptExecutorProvider(registered.implementation),
      contractReference: registered.reference,
    });
  }

  return freeze({ kind: "executor", executor: getSkillScriptExecutor() });
}

async function executeSkillScriptWithProviderInternal(
  provider: Readonly<SkillScriptExecutorProviderSnapshot>,
  input: Readonly<SkillScriptExecutorInput>,
  budget: SkillOperationBudget,
  contractReference?: Readonly<ContractReference<unknown>>,
): Promise<Readonly<SkillScriptResult>> {
  const timeoutReason = budget.timeoutMs === undefined
    ? undefined
    : budget.timeoutError ?? new SkillOperationTimeoutError(budget.timeoutMs);
  const contractLease = contractReference === undefined
    ? undefined
    : acquireContractLease(contractReference);
  const abortSignal = budget.abortSignal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  let abortListenerAttached = false;
  let terminationStarted = false;
  let terminationReason: unknown;
  const controlFailures: unknown[] = [];
  const terminationControlFailures: unknown[] = [];

  try {
    const handle = provider.prepare(input);
    const resultSettlementPromise = observeSkillScriptExecutionSettlementWithoutHooks(
      handle.result,
    );
    const terminalSettlementPromise = observeSkillScriptExecutionSettlementWithoutHooks(
      handle.terminal,
    );
    const terminate = (reason: unknown): void => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminationReason = reason;
      try {
        handle.terminate(reason);
      } catch (error) {
        appendUniqueFailure(controlFailures, error);
        appendUniqueFailure(terminationControlFailures, error);
      }
    };
    const terminateForRetirement = (reason: unknown): void => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminationReason = reason;
      try {
        if (!requestSkillScriptExecutionTermination(handle, reason)) {
          terminationStarted = false;
          terminationReason = undefined;
        }
      } catch (error) {
        appendUniqueFailure(controlFailures, error);
        appendUniqueFailure(terminationControlFailures, error);
      }
    };
    const terminateIfBudgetExpired = (): void => {
      try {
        budget.throwIfTerminated();
      } catch (reason) {
        terminate(reason);
      }
    };

    contractLease?.setRetirementHandler(terminateForRetirement);

    try {
      if (abortSignal) {
        abortListener = terminateIfBudgetExpired;
        addAbortSignalListenerOnce(abortSignal, abortListener);
        abortListenerAttached = true;
      }

      const remainingMs = budget.remainingMs();
      if (remainingMs !== undefined) {
        if (remainingMs === 0) {
          terminate(timeoutReason!);
        } else {
          timeoutId = scheduleTimeout(
            () => terminate(timeoutReason!),
            remainingMs,
          );
        }
      }
    } catch (error) {
      appendUniqueFailure(controlFailures, error);
      terminate(error);
    }

    terminateIfBudgetExpired();

    if (!terminationStarted) {
      try {
        handle.activate();
      } catch (error) {
        appendUniqueFailure(controlFailures, error);
      }
      terminateIfBudgetExpired();
    }

    const resultSettlement = await resultSettlementPromise;
    const terminalSettlement = await terminalSettlementPromise;
    terminateIfBudgetExpired();
    if (timeoutReason !== undefined && terminationReason === timeoutReason) {
      const cleanupFailures: unknown[] = [];
      if (
        !terminalSettlement.fulfilled &&
        terminalSettlement.reason !== timeoutReason
      ) {
        appendUniqueFailure(cleanupFailures, terminalSettlement.reason);
      }
      for (let index = 0; index < terminationControlFailures.length; index += 1) {
        appendUniqueFailure(cleanupFailures, terminationControlFailures[index]);
      }
      if (cleanupFailures.length === 0) throw timeoutReason;
      appendUniqueFailure(cleanupFailures, timeoutReason);
      throwExecutionFailures(cleanupFailures);
    }

    const failures: unknown[] = [];
    if (!resultSettlement.fulfilled) {
      appendUniqueFailure(failures, resultSettlement.reason);
    }
    if (!terminalSettlement.fulfilled) {
      appendUniqueFailure(failures, terminalSettlement.reason);
    }
    for (let index = 0; index < controlFailures.length; index += 1) {
      appendUniqueFailure(failures, controlFailures[index]);
    }
    if (terminationStarted) {
      appendUniqueFailure(failures, terminationReason);
    }
    if (failures.length > 0) throwExecutionFailures(failures);
    if (!resultSettlement.fulfilled) throw resultSettlement.reason;
    return resultSettlement.value;
  } finally {
    if (timeoutId !== undefined) clearScheduledTimeout(timeoutId);
    if (abortSignal && abortListener && abortListenerAttached) {
      removeAbortSignalListener(abortSignal, abortListener);
    }
    contractLease?.release();
  }
}

function preserveExecutionResult(
  result: Readonly<SkillScriptResult>,
): Readonly<SkillScriptResult> {
  return result;
}

function rethrowExecutionFailure(reason: unknown): never {
  throw reason;
}

/**
 * Execute one lifecycle provider without exposing settlement before cleanup.
 *
 * Timeout and abort handling are installed before activation. Once cancellation
 * starts, provider termination is forwarded once by the validated handle and
 * this function continues to consume both result and terminal settlements. The
 * returned Promise pins its intrinsic constructor so provider code cannot
 * interfere with caller observation through mutable Promise hooks.
 */
export function executeSkillScriptWithProvider(
  provider: Readonly<SkillScriptExecutorProviderSnapshot>,
  input: Readonly<SkillScriptExecutorInput>,
  budget: SkillOperationBudget,
  contractReference?: Readonly<ContractReference<unknown>>,
): Promise<Readonly<SkillScriptResult>> {
  const execution = executeSkillScriptWithProviderInternal(
    provider,
    input,
    budget,
    contractReference,
  );
  return createIntrinsicPromiseContinuation(
    execution,
    preserveExecutionResult,
    rethrowExecutionFailure,
  );
}
