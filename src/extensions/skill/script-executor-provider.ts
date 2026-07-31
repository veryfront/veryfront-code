/**
 * Extension boundary for lifecycle-owned skill script execution.
 *
 * Application composition may explicitly select and snapshot one provider.
 * This authoring contract does not register or auto-resolve implementations.
 * Providers prepare inert controls, while core owns result and terminal
 * promises before external work can be activated.
 *
 * @module extensions/skill/script-executor-provider
 */

import {
  isNativeAsyncFunctionWithoutHooks,
  isNativePromiseWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import type { SkillScriptExecutorInput, SkillScriptResult } from "#veryfront/skill/types.ts";
import { snapshotSkillScriptResult } from "#veryfront/skill/script-result.ts";
import {
  type NormalizedSkillScriptExecutorInput,
  snapshotSkillScriptExecutorInput,
} from "#veryfront/skill/script-executor-input.ts";
import { createIntrinsicPromiseContinuation } from "../promise-intrinsics-internal.ts";

const apply = Reflect.apply;
const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const arrayIterator = Array.prototype[arrayIteratorSymbol];
const arrayIsArray = Array.isArray;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const NativeAggregateError = AggregateError;
const NativeError = Error;
const NativeObjectPrototype = Object.prototype;
const NativePromise = Promise;
const NativePromisePrototype = Promise.prototype;
const NativeWeakMap = WeakMap;
const NativeTypeError = TypeError;
const ownKeys = Reflect.ownKeys;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;

/** Contract name registered by one composed script-execution extension. */
export const SkillScriptExecutorProviderName = "SkillScriptExecutorProvider" as const;

/** Provider callbacks used to report one result and one terminal settlement. */
export interface SkillScriptExecutionReporter {
  readonly resolveResult: (result: SkillScriptResult) => void;
  readonly rejectResult: (reason: unknown) => void;
  readonly resolveTerminal: () => void;
  readonly rejectTerminal: (reason: unknown) => void;
}

/** Inert provider-owned controls returned before execution begins. */
export interface SkillScriptPreparedExecution {
  /** Start the prepared work synchronously. Forwarded at most once. */
  readonly activate: () => void;
  /** Initiate cancellation synchronously. Forwarded at most once. */
  readonly terminate: (reason?: unknown) => void;
}

/** Core-owned execution lifecycle returned to application composition. */
export interface SkillScriptExecutionHandle extends SkillScriptPreparedExecution {
  /** Detached, bounded script outcome reported by the provider. */
  readonly result: Promise<Readonly<SkillScriptResult>>;
  /** Settles after both the result and provider-owned cleanup are reported. */
  readonly terminal: Promise<void>;
}

/** Canonical detached input delivered to a composed execution provider. */
export type SkillScriptExecutorProviderInput = NormalizedSkillScriptExecutorInput;

/** Extension-owned implementation selected by application composition. */
export interface SkillScriptExecutorProvider {
  /**
   * Prepare and return inert controls synchronously. Implementations must not
   * spawn, provision, or issue a request until `activate()` is invoked. Report
   * the first result and terminal settlement through the core-owned reporter.
   * This function property must not depend on a receiver.
   */
  readonly prepare: (
    input: Readonly<SkillScriptExecutorProviderInput>,
    reporter: Readonly<SkillScriptExecutionReporter>,
  ) => SkillScriptPreparedExecution;
}

/** Validated provider facade that owns settlement promises for its caller. */
export interface SkillScriptExecutorProviderSnapshot {
  readonly prepare: (
    input: Readonly<SkillScriptExecutorInput>,
  ) => Readonly<SkillScriptExecutionHandle>;
}

type DescriptorMap = Record<PropertyKey, PropertyDescriptor>;
type Settlement<T> =
  | { readonly fulfilled: true; readonly value: T }
  | { readonly fulfilled: false; readonly reason: unknown };

interface CapturedPreparedExecution {
  readonly activate: (...args: unknown[]) => unknown;
  readonly terminate: (...args: unknown[]) => unknown;
}

type SkillScriptTerminationTransition = (reason?: unknown) => boolean;

const skillScriptTerminationTransitions = new NativeWeakMap<
  SkillScriptExecutionHandle["terminate"],
  SkillScriptTerminationTransition
>();

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function createFulfilledSettlement<T>(value: T): Settlement<T> {
  const settlement = createObject(null) as {
    fulfilled: true;
    value: T;
  };
  settlement.fulfilled = true;
  settlement.value = value;
  return freeze(settlement);
}

function createRejectedSettlement<T>(reason: unknown): Settlement<T> {
  const settlement = createObject(null) as {
    fulfilled: false;
    reason: unknown;
  };
  settlement.fulfilled = false;
  settlement.reason = reason;
  return freeze(settlement);
}

function createDataDescriptor(
  value: unknown,
  configurable = true,
  writable = true,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = configurable;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = writable;
  return descriptor;
}

function containsOnlyExpectedKeys(
  keys: readonly PropertyKey[],
  expectedKeys: readonly string[],
): boolean {
  if (keys.length !== expectedKeys.length) return false;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex];
    let matched = false;
    for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
      if (key === expectedKeys[expectedIndex]) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function inspectExactPlainObject(
  value: unknown,
  label: string,
  expectedKeys: readonly string[],
): DescriptorMap {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new NativeTypeError(`${label} must be an object`);
  }
  if (isProxyWithoutHooks(value)) {
    throw new NativeTypeError(`${label} must not be a proxy`);
  }

  let isArray: boolean;
  let prototype: object | null;
  let descriptors: DescriptorMap;
  try {
    isArray = arrayIsArray(value);
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value) as DescriptorMap;
  } catch (cause) {
    throw new NativeTypeError(`${label} could not be inspected`, { cause });
  }

  if (isArray) throw new NativeTypeError(`${label} must be an object`);
  if (prototype !== NativeObjectPrototype && prototype !== null) {
    throw new NativeTypeError(`${label} must be a plain object`);
  }
  if (!containsOnlyExpectedKeys(ownKeys(descriptors), expectedKeys)) {
    throw new NativeTypeError(`${label} must contain only its documented own properties`);
  }
  return descriptors;
}

function captureDataFunction(
  descriptor: PropertyDescriptor | undefined,
  label: string,
): (...args: unknown[]) => unknown {
  const candidate = descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value") ||
    typeof candidate !== "function" ||
    isProxyWithoutHooks(candidate)
  ) {
    throw new NativeTypeError(
      `${label} must be an enumerable, non-proxy function data property`,
    );
  }
  return candidate as (...args: unknown[]) => unknown;
}

async function observePromiseRejectionWithAwait(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (_) {
    // Observation is the entire purpose of this detached core-owned task.
  }
}

function observeFrozenIntrinsicPromiseRejection(promise: Promise<unknown>): boolean {
  try {
    if (getPrototypeOf(promise) !== NativePromisePrototype) return false;
    if (getOwnPropertyDescriptor(promise, "constructor") !== undefined) return false;
    const prototypeConstructor = getOwnPropertyDescriptor(
      NativePromisePrototype,
      "constructor",
    );
    if (
      !prototypeConstructor ||
      !hasOwn(prototypeConstructor, "value") ||
      prototypeConstructor.value !== NativePromise
    ) {
      return false;
    }
    void observePromiseRejectionWithAwait(promise);
    return true;
  } catch {
    return false;
  }
}

function createPromiseContinuationWithoutHooks<T, R>(
  promise: Promise<T>,
  onFulfilled: (value: T) => R,
  onRejected: (reason: unknown) => R,
): Promise<R> | undefined {
  try {
    return createIntrinsicPromiseContinuation(
      promise,
      onFulfilled,
      onRejected,
    );
  } catch {
    return undefined;
  }
}

function ignorePromiseSettlement(_value: unknown): void {}

function observePromiseRejectionWithoutHooks(promise: Promise<unknown>): boolean {
  return createPromiseContinuationWithoutHooks(
    promise,
    ignorePromiseSettlement,
    ignorePromiseSettlement,
  ) !== undefined;
}

function observeCorePromiseRejection<T>(promise: Promise<T>): void {
  if (!observePromiseRejectionWithoutHooks(promise)) {
    throw new NativeTypeError("Core-owned Promise rejection observer could not be installed");
  }
}

/**
 * Attach one value-preserving settlement observation without consulting live
 * Promise constructor, species, or `then` hooks.
 *
 * This is intentionally not re-exported from the public extension barrel. It
 * is the runtime bridge for promises created by the validated provider
 * snapshot before provider code can mutate the host realm.
 */
export function observeSkillScriptExecutionSettlementWithoutHooks<T>(
  promise: Promise<T>,
): Promise<Settlement<T>> {
  if (!isNativePromiseWithoutHooks(promise) || isProxyWithoutHooks(promise)) {
    throw new NativeTypeError("Skill script execution settlement must be a native Promise");
  }
  const observation = createPromiseContinuationWithoutHooks(
    promise,
    (value): Settlement<T> => createFulfilledSettlement(value),
    (reason): Settlement<T> => createRejectedSettlement(reason),
  );
  if (!observation) {
    throw new NativeTypeError("Skill script execution settlement observer could not be installed");
  }
  return observation;
}

/**
 * Observe the ordinary accidental `Promise.reject()` contract violation when
 * it is an exact current-realm Promise. Exotic promises are never assimilated
 * because doing so could invoke provider-owned constructor or `then` hooks.
 */
function observeUnexpectedIntrinsicPromise(value: unknown): void {
  if (!isNativePromiseWithoutHooks(value) || isProxyWithoutHooks(value)) return;
  if (!observePromiseRejectionWithoutHooks(value)) {
    observeFrozenIntrinsicPromiseRejection(value);
  }
}

function createFailurePair(
  first: unknown,
  second: unknown,
  message: string,
): AggregateError {
  const failures = [first, second];
  defineProperty(
    failures,
    arrayIteratorSymbol,
    createDataDescriptor(arrayIterator, false, false),
  );
  return new NativeAggregateError(
    failures,
    message,
  );
}

function createControlFailure(
  activationError: unknown,
  terminationError: unknown,
): AggregateError {
  return createFailurePair(
    activationError,
    terminationError,
    "Skill script activation and cleanup failed",
  );
}

function captureSkillScriptPreparedExecution(
  value: unknown,
): CapturedPreparedExecution {
  if (isNativePromiseWithoutHooks(value)) {
    observeUnexpectedIntrinsicPromise(value);
    throw new NativeTypeError(
      "Skill script executor provider prepare() must return inert controls synchronously, not a Promise",
    );
  }

  const descriptors = inspectExactPlainObject(
    value,
    "Prepared skill script execution",
    ["activate", "terminate"],
  );
  const capturedActivate = captureDataFunction(
    descriptors.activate,
    "Prepared skill script execution activate",
  );
  const capturedTerminate = captureDataFunction(
    descriptors.terminate,
    "Prepared skill script execution terminate",
  );
  if (
    isNativeAsyncFunctionWithoutHooks(capturedActivate) ||
    isNativeAsyncFunctionWithoutHooks(capturedTerminate)
  ) {
    throw new NativeTypeError(
      "Prepared skill script execution controls must be synchronous",
    );
  }

  return { activate: capturedActivate, terminate: capturedTerminate };
}

function rejectPromiseReturningControl(value: unknown, label: string): void {
  if (!isNativePromiseWithoutHooks(value) || isProxyWithoutHooks(value)) return;
  observeUnexpectedIntrinsicPromise(value);
  throw new NativeTypeError(`${label} must complete synchronously, not return a Promise`);
}

function snapshotCapturedPreparedExecution(
  captured: CapturedPreparedExecution,
): Readonly<SkillScriptPreparedExecution> {
  const capturedActivate = captured.activate;
  const capturedTerminate = captured.terminate;

  let state: "prepared" | "active" | "terminated" = "prepared";
  const activate = freeze((): void => {
    if (state !== "prepared") return;
    state = "active";
    let activationResult: unknown;
    try {
      activationResult = apply(capturedActivate, undefined, []);
    } catch (reason) {
      observeUnexpectedIntrinsicPromise(reason);
      throw reason;
    }
    rejectPromiseReturningControl(
      activationResult,
      "Prepared skill script execution activate",
    );
  });
  const terminate = freeze((reason?: unknown): void => {
    observeUnexpectedIntrinsicPromise(reason);
    if (state === "terminated") return;
    state = "terminated";
    let terminationResult: unknown;
    try {
      terminationResult = apply(capturedTerminate, undefined, [reason]);
    } catch (error) {
      observeUnexpectedIntrinsicPromise(error);
      throw error;
    }
    rejectPromiseReturningControl(
      terminationResult,
      "Prepared skill script execution terminate",
    );
  });
  return freeze({ activate, terminate });
}

/** Capture inert controls without retaining mutable method properties. */
export function snapshotSkillScriptPreparedExecution(
  value: unknown,
): Readonly<SkillScriptPreparedExecution> {
  return snapshotCapturedPreparedExecution(captureSkillScriptPreparedExecution(value));
}

function createExecutionSettlementState(): {
  readonly reporter: Readonly<SkillScriptExecutionReporter>;
  bindControls(
    captured: CapturedPreparedExecution,
  ): Readonly<SkillScriptPreparedExecution>;
  commit(): Pick<SkillScriptExecutionHandle, "result" | "terminal">;
  discard(): void;
} {
  let discarded = false;
  let committed = false;
  let lifecycleStarted = false;
  let preactivationViolation = false;
  let settlementPublicationPaused = false;
  let lifecycleState: "preparing" | "prepared" | "active" | "cancelling" | "terminal" = "preparing";
  let resultSettlement: Settlement<Readonly<SkillScriptResult>> | undefined;
  let terminalSettlement: Settlement<void> | undefined;
  let resolveResultPromise!: (value: Readonly<SkillScriptResult>) => void;
  let rejectResultPromise!: (reason: unknown) => void;
  let resolveTerminalPromise!: () => void;
  let rejectTerminalPromise!: (reason: unknown) => void;

  // Install internal rejection observers before any provider code can run.
  // The original promises remain public and retain their rejection semantics.
  const result = new NativePromise<Readonly<SkillScriptResult>>((resolve, reject) => {
    resolveResultPromise = resolve;
    rejectResultPromise = reject;
  });
  const terminal = new NativePromise<void>((resolve, reject) => {
    resolveTerminalPromise = resolve;
    rejectTerminalPromise = reject;
  });
  observeCorePromiseRejection(result);
  observeCorePromiseRejection(terminal);

  // Keep settlement and Promise publication separate: provider callbacks may
  // run during prepare(), but settlement is buffered until controls pass
  // validation and ownership can be returned to the caller.
  const settlePublishedPromises = (): void => {
    if (settlementPublicationPaused || !committed || !resultSettlement) return;
    if (resultSettlement.fulfilled) resolveResultPromise(resultSettlement.value);
    else rejectResultPromise(resultSettlement.reason);
    if (!terminalSettlement) return;
    if (terminalSettlement.fulfilled) resolveTerminalPromise();
    else rejectTerminalPromise(terminalSettlement.reason);
  };

  const rejectUnsettledLifecycle = (reason: unknown): void => {
    if (!resultSettlement) resultSettlement = createRejectedSettlement(reason);
    if (!terminalSettlement) terminalSettlement = createRejectedSettlement(reason);
    settlePublishedPromises();
  };

  const rejectUnsettledResult = (reason: unknown): void => {
    if (!resultSettlement) resultSettlement = createRejectedSettlement(reason);
    settlePublishedPromises();
  };

  const rejectTerminalAfterControlFailure = (reason: unknown): void => {
    const terminalReason = terminalSettlement && !terminalSettlement.fulfilled &&
        terminalSettlement.reason !== reason
      ? createFailurePair(
        terminalSettlement.reason,
        reason,
        "Skill script cleanup failed more than once",
      )
      : reason;
    terminalSettlement = createRejectedSettlement(terminalReason);
    settlePublishedPromises();
  };

  const rejectSettlementBeforeActivation = (): void => {
    preactivationViolation = true;
    lifecycleState = "terminal";
    rejectUnsettledLifecycle(
      new NativeTypeError("Skill script executor provider reported settlement before activation"),
    );
  };

  const canReportSettlement = (): boolean => {
    if (discarded) return false;
    if (!lifecycleStarted) {
      rejectSettlementBeforeActivation();
      return false;
    }
    return true;
  };

  const resolveResult = freeze((value: SkillScriptResult): void => {
    // A provider that accidentally reports a rejected Promise must not leak an
    // unhandled rejection even when this report is pre-activation or ignored
    // after the first result settlement.
    observeUnexpectedIntrinsicPromise(value);
    if (resultSettlement || !canReportSettlement()) return;
    try {
      resultSettlement = createFulfilledSettlement(snapshotSkillScriptResult(value));
    } catch (reason) {
      resultSettlement = createRejectedSettlement(reason);
    }
    settlePublishedPromises();
  });
  const rejectResult = freeze((reason: unknown): void => {
    observeUnexpectedIntrinsicPromise(reason);
    if (resultSettlement || !canReportSettlement()) return;
    resultSettlement = createRejectedSettlement(reason);
    settlePublishedPromises();
  });
  const resolveTerminal = freeze((): void => {
    if (terminalSettlement || !canReportSettlement()) return;
    lifecycleState = "terminal";
    terminalSettlement = createFulfilledSettlement(undefined);
    settlePublishedPromises();
  });
  const rejectTerminal = freeze((reason: unknown): void => {
    observeUnexpectedIntrinsicPromise(reason);
    if (terminalSettlement || !canReportSettlement()) return;
    lifecycleState = "terminal";
    terminalSettlement = createRejectedSettlement(reason);
    settlePublishedPromises();
  });
  const reporter = freeze({
    resolveResult,
    rejectResult,
    resolveTerminal,
    rejectTerminal,
  });

  return {
    reporter,
    bindControls(captured) {
      if (
        discarded ||
        (lifecycleState !== "preparing" && !preactivationViolation)
      ) {
        throw new NativeTypeError("Skill script execution controls are no longer available");
      }
      if (!preactivationViolation) lifecycleState = "prepared";
      let terminationForwarded = false;

      const forwardTermination = (reason?: unknown): void => {
        if (terminationForwarded) return;
        terminationForwarded = true;
        const terminationResult = apply(captured.terminate, undefined, [reason]);
        rejectPromiseReturningControl(
          terminationResult,
          "Prepared skill script execution terminate",
        );
      };

      const activate = freeze((): void => {
        if (lifecycleState !== "prepared") return;
        lifecycleStarted = true;
        lifecycleState = "active";
        try {
          const activationResult = apply(captured.activate, undefined, []);
          rejectPromiseReturningControl(
            activationResult,
            "Prepared skill script execution activate",
          );
        } catch (activationError) {
          observeUnexpectedIntrinsicPromise(activationError);
          rejectUnsettledResult(activationError);
          if (terminalSettlement) {
            lifecycleState = "terminal";
            throw activationError;
          }
          lifecycleState = "cancelling";
          let failure = activationError;
          settlementPublicationPaused = true;
          try {
            forwardTermination(activationError);
          } catch (terminationError) {
            observeUnexpectedIntrinsicPromise(terminationError);
            failure = createControlFailure(activationError, terminationError);
            lifecycleState = "terminal";
            rejectTerminalAfterControlFailure(failure);
          } finally {
            settlementPublicationPaused = false;
            settlePublishedPromises();
          }
          throw failure;
        }
      });
      const transitionToCancelling = (reason?: unknown): boolean => {
        observeUnexpectedIntrinsicPromise(reason);
        if (lifecycleState === "cancelling") return false;
        if (lifecycleState === "terminal") {
          if (!resultSettlement) {
            rejectUnsettledResult(
              reason === undefined
                ? new NativeError(
                  "Skill script execution terminated before reporting a result",
                )
                : reason,
            );
          }
          return false;
        }
        lifecycleStarted = true;
        lifecycleState = "cancelling";
        settlementPublicationPaused = true;
        try {
          forwardTermination(reason);
          if (terminalSettlement && !resultSettlement) {
            rejectUnsettledResult(
              reason === undefined
                ? new NativeError(
                  "Skill script execution terminated before reporting a result",
                )
                : reason,
            );
          }
        } catch (error) {
          observeUnexpectedIntrinsicPromise(error);
          lifecycleState = "terminal";
          rejectUnsettledResult(error);
          rejectTerminalAfterControlFailure(error);
          throw error;
        } finally {
          settlementPublicationPaused = false;
          settlePublishedPromises();
        }
        return true;
      };
      const terminate = freeze((reason?: unknown): void => {
        transitionToCancelling(reason);
      });
      apply(weakMapSet, skillScriptTerminationTransitions, [
        terminate,
        transitionToCancelling,
      ]);
      return freeze({ activate, terminate });
    },
    commit() {
      if (committed || discarded) {
        throw new NativeTypeError("Skill script execution settlement is no longer available");
      }
      committed = true;
      settlePublishedPromises();
      return freeze({ result, terminal });
    },
    discard() {
      discarded = true;
      resultSettlement = undefined;
      terminalSettlement = undefined;
    },
  };
}

/**
 * Request termination through a handle created by the validated snapshot.
 *
 * @internal Returns whether cancellation actually transitioned a non-terminal
 * execution. The public `terminate()` contract intentionally remains `void`.
 */
export function requestSkillScriptExecutionTermination(
  handle: Readonly<SkillScriptExecutionHandle>,
  reason?: unknown,
): boolean {
  const transition = apply(
    weakMapGet,
    skillScriptTerminationTransitions,
    [handle.terminate],
  ) as SkillScriptTerminationTransition | undefined;
  if (transition === undefined) {
    throw new NativeTypeError(
      "Skill script execution termination transition was unavailable",
    );
  }
  return apply(transition, undefined, [reason]) as boolean;
}

/** Capture a provider and validate inert controls before returning ownership. */
export function snapshotSkillScriptExecutorProvider(
  value: unknown,
): Readonly<SkillScriptExecutorProviderSnapshot> {
  const descriptors = inspectExactPlainObject(
    value,
    "Skill script executor provider",
    ["prepare"],
  );
  const capturedPrepare = captureDataFunction(
    descriptors.prepare,
    "Skill script executor provider prepare",
  );
  if (isNativeAsyncFunctionWithoutHooks(capturedPrepare)) {
    throw new NativeTypeError(
      "Skill script executor provider prepare must be synchronous",
    );
  }

  const prepare = freeze(
    (input: Readonly<SkillScriptExecutorInput>): Readonly<SkillScriptExecutionHandle> => {
      const inputSnapshot = snapshotSkillScriptExecutorInput(input);
      const settlement = createExecutionSettlementState();
      let rawControls: unknown;
      try {
        rawControls = apply(capturedPrepare, undefined, [inputSnapshot, settlement.reporter]);
      } catch (error) {
        observeUnexpectedIntrinsicPromise(error);
        settlement.discard();
        throw error;
      }

      let controls: Readonly<SkillScriptPreparedExecution>;
      try {
        const capturedControls = captureSkillScriptPreparedExecution(rawControls);
        controls = settlement.bindControls(capturedControls);
      } catch (error) {
        settlement.discard();
        throw error;
      }
      const promises = settlement.commit();
      return freeze({ ...controls, ...promises });
    },
  );

  return freeze({ prepare });
}
