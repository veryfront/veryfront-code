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
import { CONFIG_INVALID } from "#veryfront/errors";
import { SKILL_SCRIPT_PROVIDER_TERMINATION_GRACE_MS } from "./limits.ts";
import { type SkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";

const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const arrayIterator = Array.prototype[arrayIteratorSymbol];
const clearScheduledTimeout = clearTimeout;
const createObject = Object.create;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const NativeAggregateError = AggregateError;
const NativePromise = Promise;
const NativeRangeError = RangeError;
const numberIsSafeInteger = Number.isSafeInteger;
const scheduleTimeout = setTimeout;

type ExecutionSettlement<T> =
  | { readonly fulfilled: true; readonly value: T }
  | { readonly fulfilled: false; readonly reason: unknown };

type ProviderLifecycleSettlements = Readonly<{
  result: ExecutionSettlement<Readonly<SkillScriptResult>>;
  terminal: ExecutionSettlement<void>;
}>;

type ProviderLifecycleRace =
  | { readonly kind: "settled"; readonly settlements: ProviderLifecycleSettlements }
  | { readonly kind: "grace-expired" };

const graceExpiredRecord = createObject(null) as { kind: "grace-expired" };
graceExpiredRecord.kind = "grace-expired";
const GRACE_EXPIRED = freeze(graceExpiredRecord) as ProviderLifecycleRace;

function createPinnedPromise<T>(
  executor: ConstructorParameters<typeof Promise<T>>[0],
): Promise<T> {
  const promise = new NativePromise<T>(executor);
  defineOwnProperty(promise, "constructor", {
    configurable: true,
    enumerable: false,
    value: NativePromise,
    writable: false,
  });
  return promise;
}

function observeProviderLifecycle(
  result: Promise<ExecutionSettlement<Readonly<SkillScriptResult>>>,
  terminal: Promise<ExecutionSettlement<void>>,
): Promise<ProviderLifecycleSettlements> {
  return createPinnedPromise<ProviderLifecycleSettlements>((resolve, reject) => {
    let resultSettlement: ExecutionSettlement<Readonly<SkillScriptResult>> | undefined;
    let terminalSettlement: ExecutionSettlement<void> | undefined;
    const finish = (): void => {
      if (resultSettlement === undefined || terminalSettlement === undefined) return;
      const settlements = createObject(null) as {
        result: ExecutionSettlement<Readonly<SkillScriptResult>>;
        terminal: ExecutionSettlement<void>;
      };
      settlements.result = resultSettlement;
      settlements.terminal = terminalSettlement;
      resolve(freeze(settlements));
    };
    const captureResult = (
      settlement: ExecutionSettlement<Readonly<SkillScriptResult>>,
    ): void => {
      try {
        resultSettlement = settlement;
        finish();
      } catch (error) {
        reject(error);
      }
    };
    const captureTerminal = (settlement: ExecutionSettlement<void>): void => {
      try {
        terminalSettlement = settlement;
        finish();
      } catch (error) {
        reject(error);
      }
    };
    createIntrinsicPromiseContinuation(result, captureResult, reject);
    createIntrinsicPromiseContinuation(terminal, captureTerminal, reject);
  });
}

function raceLifecycleAgainstGrace(
  lifecycle: Promise<ProviderLifecycleSettlements>,
  graceExpired: Promise<void>,
): Promise<ProviderLifecycleRace> {
  return createPinnedPromise<ProviderLifecycleRace>((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: ProviderLifecycleRace): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    createIntrinsicPromiseContinuation(
      lifecycle,
      (settlements) => {
        const settledRecord = createObject(null) as {
          kind: "settled";
          settlements: ProviderLifecycleSettlements;
        };
        settledRecord.kind = "settled";
        settledRecord.settlements = settlements;
        resolveOnce(freeze(settledRecord));
      },
      reject,
    );
    createIntrinsicPromiseContinuation(
      graceExpired,
      () => resolveOnce(GRACE_EXPIRED),
      reject,
    );
  });
}

function ignoreSettlement(_value: unknown): void {}

function releaseLeaseAfterLifecycle(
  lifecycle: Promise<ProviderLifecycleSettlements>,
  release: () => void,
): void {
  const lateRelease = createIntrinsicPromiseContinuation(
    lifecycle,
    () => release(),
    () => release(),
  );
  createIntrinsicPromiseContinuation(
    lateRelease,
    ignoreSettlement,
    ignoreSettlement,
  );
}

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
 * missing, unavailable, or malformed provider fails closed; core never guesses
 * an execution environment or invokes an application-owned runtime.
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

  throw CONFIG_INVALID.create({
    detail:
      "Skill script execution requires an explicit SkillScriptExecutor or an active SkillScriptExecutorProvider extension",
  });
}

async function executeSkillScriptWithProviderInternal(
  provider: Readonly<SkillScriptExecutorProviderSnapshot>,
  input: Readonly<SkillScriptExecutorInput>,
  budget: SkillOperationBudget,
  contractReference?: Readonly<ContractReference<unknown>>,
  terminationGraceMs = SKILL_SCRIPT_PROVIDER_TERMINATION_GRACE_MS,
): Promise<Readonly<SkillScriptResult>> {
  if (!numberIsSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new NativeRangeError(
      "Skill provider termination grace must be a non-negative safe integer",
    );
  }
  const timeoutReason = budget.timeoutMs === undefined
    ? undefined
    : budget.timeoutError ?? new SkillOperationTimeoutError(budget.timeoutMs);
  const contractLease = contractReference === undefined
    ? undefined
    : acquireContractLease(contractReference);
  const abortSignal = budget.abortSignal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let terminationGraceTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let resolveTerminationGrace!: () => void;
  const terminationGraceExpired = createPinnedPromise<void>((resolve) => {
    resolveTerminationGrace = resolve;
  });
  let abortListener: (() => void) | undefined;
  let abortListenerAttached = false;
  let terminationStarted = false;
  let terminationReason: unknown;
  let leaseReleaseDeferred = false;
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
    const lifecycleSettlementPromise = observeProviderLifecycle(
      resultSettlementPromise,
      terminalSettlementPromise,
    );
    const lifecycleRacePromise = raceLifecycleAgainstGrace(
      lifecycleSettlementPromise,
      terminationGraceExpired,
    );
    const startTerminationGrace = (): void => {
      if (terminationGraceTimeoutId !== undefined) return;
      terminationGraceTimeoutId = scheduleTimeout(
        resolveTerminationGrace,
        terminationGraceMs,
      );
    };
    const terminate = (reason: unknown): void => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminationReason = reason;
      startTerminationGrace();
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
        } else {
          startTerminationGrace();
        }
      } catch (error) {
        appendUniqueFailure(controlFailures, error);
        appendUniqueFailure(terminationControlFailures, error);
      }
    };
    const terminateIfBudgetExpired = (): boolean => {
      try {
        budget.throwIfTerminated();
        return false;
      } catch (reason) {
        terminate(reason);
        return true;
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
        if (!terminateIfBudgetExpired()) terminate(error);
      }
      terminateIfBudgetExpired();
    }

    const lifecycleRace = await lifecycleRacePromise;
    if (lifecycleRace.kind === "grace-expired") {
      if (contractLease !== undefined) {
        contractLease.quarantine();
        leaseReleaseDeferred = true;
        releaseLeaseAfterLifecycle(
          lifecycleSettlementPromise,
          contractLease.release,
        );
      }
      throw terminationReason;
    }
    const resultSettlement = lifecycleRace.settlements.result;
    const terminalSettlement = lifecycleRace.settlements.terminal;
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
    if (terminationGraceTimeoutId !== undefined) {
      clearScheduledTimeout(terminationGraceTimeoutId);
    }
    if (abortSignal && abortListener && abortListenerAttached) {
      removeAbortSignalListener(abortSignal, abortListener);
    }
    if (!leaseReleaseDeferred) contractLease?.release();
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
 * Execute one lifecycle provider with bounded post-cancellation cleanup.
 *
 * Timeout and abort handling are installed before activation. Once cancellation
 * starts, provider termination is forwarded once by the validated handle and
 * this function continues to consume both result and terminal settlements. If
 * cleanup exceeds its grace, the public Promise rejects with the original
 * cancellation while a managed generation remains quarantined until both late
 * settlements arrive. The returned Promise pins its intrinsic constructor so
 * provider code cannot interfere with caller observation through mutable
 * Promise hooks.
 */
export function executeSkillScriptWithProvider(
  provider: Readonly<SkillScriptExecutorProviderSnapshot>,
  input: Readonly<SkillScriptExecutorInput>,
  budget: SkillOperationBudget,
  contractReference?: Readonly<ContractReference<unknown>>,
  terminationGraceMs = SKILL_SCRIPT_PROVIDER_TERMINATION_GRACE_MS,
): Promise<Readonly<SkillScriptResult>> {
  const execution = executeSkillScriptWithProviderInternal(
    provider,
    input,
    budget,
    contractReference,
    terminationGraceMs,
  );
  return createIntrinsicPromiseContinuation(
    execution,
    preserveExecutionResult,
    rethrowExecutionFailure,
  );
}
