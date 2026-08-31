import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  canIdentifyProxyWithoutHooks,
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const DETACHED_CONTINUATION_FAILURE = "downstream continuation rejected";
const IntrinsicPromise = Promise;
const IntrinsicWeakSet = WeakSet;
const PromiseResolve = Promise.resolve;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const PromiseThen = Promise.prototype.then;
const ReflectApply = Reflect.apply;
const SymbolSpecies = Symbol.species;
const WeakSetAdd = WeakSet.prototype.add;
const WeakSetHas = WeakSet.prototype.has;
// These intrinsic WeakSets retain only live keys; entries are collectible once
// no middleware or error consumer retains the associated objects.
const INVALID_CONTINUATION_ERRORS = new IntrinsicWeakSet<object>();
const TRACKED_CONTINUATIONS = new IntrinsicWeakSet<object>();
const OBSERVED_CONTINUATIONS = new IntrinsicWeakSet<object>();
const CONTINUATION_SPECIES_HOLDER = ReflectApply(ObjectCreate, Object, [null]) as object;
ObjectDefineProperty(CONTINUATION_SPECIES_HOLDER, SymbolSpecies, {
  value: IntrinsicPromise,
});
// A global symbol lets independently loaded package copies recognize the
// expected internal error; the WeakSet remains the primary local check.
const INVALID_CONTINUATION_MARKER = Symbol.for(
  "veryfront.agent.middleware.invalid-continuation",
);
const DOM_EXCEPTION_NAME_GETTER = typeof DOMException === "function"
  ? ObjectGetOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;
const PROMISE_SPECIES_SUPPORTED = (() => {
  class SpeciesProbe extends Promise<void> {}
  const probe = new SpeciesProbe((resolve) => resolve(undefined));
  return probe.then() instanceof SpeciesProbe;
})();

type ContinuationThenHandler<T, R> =
  | ((value: T) => R | PromiseLike<R>)
  | null
  | undefined;

type ContinuationExecutor<T> = (
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason?: unknown) => void,
) => void;

type ContinuationRejectionHandler = (
  error: unknown,
  isObserved: () => boolean,
) => void;

class ObservedContinuationPromise<T> extends Promise<T> {
  constructor(
    executor: ContinuationExecutor<T>,
    private readonly onRejection?: ContinuationRejectionHandler,
    private readonly suppressedInvalidErrors = new IntrinsicWeakSet<object>(),
  ) {
    super(executor);
    ReflectApply(WeakSetAdd, TRACKED_CONTINUATIONS, [this]);
  }

  override then<TResult1 = T, TResult2 = never>( // NOSONAR: tracks rejection observation; catch/finally delegate here.
    onFulfilled?: ContinuationThenHandler<T, TResult1>,
    onRejected?: ContinuationThenHandler<unknown, TResult2>,
  ): Promise<TResult1 | TResult2> {
    ReflectApply(WeakSetAdd, OBSERVED_CONTINUATIONS, [this]);
    const derived = super.then(onFulfilled, onRejected);
    if (this.onRejection) {
      const observedDerived = derived as ObservedContinuationPromise<TResult1 | TResult2>;
      if (!PROMISE_SPECIES_SUPPORTED || typeof observedDerived.isObserved !== "function") {
        // Preserve the runtime-selected branch and suppress native unhandled
        // rejection noise when its observation state cannot be tracked.
        observeContinuationRejection(derived);
        return derived;
      }
      observeContinuationRejection(
        derived,
        this.onRejection,
        () => {
          return observedDerived.isObserved();
        },
        this.suppressedInvalidErrors,
      );
    }
    return derived;
  }

  isObserved(): boolean {
    return ReflectApply(WeakSetHas, OBSERVED_CONTINUATIONS, [this]) as boolean;
  }
}

function trackEagerContinuation<T>(
  promise: Promise<T>,
  onRejection: ContinuationRejectionHandler,
  suppressedInvalidErrors = new IntrinsicWeakSet<object>(),
): Promise<T> {
  if (ReflectApply(WeakSetHas, TRACKED_CONTINUATIONS, [promise]) as boolean) {
    return createObservedContinuation<T>(
      (resolve, reject) => {
        void ReflectApply(PromiseThen, promise, [resolve, reject]);
      },
      onRejection,
      suppressedInvalidErrors,
    );
  }
  ReflectApply(WeakSetAdd, TRACKED_CONTINUATIONS, [promise]);

  const trackedThen = function <TResult1 = T, TResult2 = never>(
    onFulfilled?: ContinuationThenHandler<T, TResult1>,
    onRejected?: ContinuationThenHandler<unknown, TResult2>,
  ): Promise<TResult1 | TResult2> {
    ReflectApply(WeakSetAdd, OBSERVED_CONTINUATIONS, [promise]);
    const derived = ReflectApply(PromiseThen, promise, [onFulfilled, onRejected]) as Promise<
      TResult1 | TResult2
    >;
    if (!PROMISE_SPECIES_SUPPORTED) {
      observeContinuationRejection(derived);
      return derived;
    }
    return trackEagerContinuation(derived, onRejection, suppressedInvalidErrors);
  };
  ObjectDefineProperty(promise, "then", {
    configurable: false,
    value: trackedThen,
    writable: false,
  });
  ObjectDefineProperty(promise, "constructor", {
    configurable: false,
    value: CONTINUATION_SPECIES_HOLDER,
    writable: false,
  });
  observeContinuationRejection(
    promise,
    onRejection,
    () => ReflectApply(WeakSetHas, OBSERVED_CONTINUATIONS, [promise]) as boolean,
    suppressedInvalidErrors,
  );
  return promise;
}

function createObservedContinuation<T>(
  executor: ContinuationExecutor<T>,
  onRejection?: ContinuationRejectionHandler,
  suppressedInvalidErrors = new IntrinsicWeakSet<object>(),
): Promise<T> {
  const continuation = new ObservedContinuationPromise<T>(
    executor,
    onRejection,
    suppressedInvalidErrors,
  );
  if (onRejection) {
    // Keep a root observer for engines without species propagation; each
    // user-created derived branch gets its own observer in then().
    observeContinuationRejection(
      continuation,
      onRejection,
      () => continuation.isObserved(),
      suppressedInvalidErrors,
    );
    if (!PROMISE_SPECIES_SUPPORTED) return continuation;

    // Allocate one class per continuation: species requires a distinct
    // constructor per observed chain.
    const DerivedContinuationPromise = class extends ObservedContinuationPromise<T> {
      static override get [Symbol.species](): PromiseConstructor {
        return this as PromiseConstructor;
      }

      constructor(derivedExecutor: ContinuationExecutor<T>) {
        super(derivedExecutor, onRejection, suppressedInvalidErrors);
      }
    };
    // Keep the species constructor tamper-resistant after wiring the branch
    // tracker onto this internal continuation.
    ObjectDefineProperty(continuation, "constructor", {
      configurable: false,
      value: DerivedContinuationPromise,
      writable: false,
    });
    // Promise species currently keeps every derived branch on this
    // per-continuation constructor. If a future engine removes that hook,
    // preserve the runtime-selected branch and contain native rejection noise.
  }
  return continuation;
}

function adoptContinuationResult(
  dispatch: () => Promise<AgentResponse>,
  resolve: (value: AgentResponse | PromiseLike<AgentResponse>) => void,
  reject: (reason?: unknown) => void,
  continuation?: Promise<AgentResponse>,
): void {
  const dispatched = dispatch();
  if (dispatched === continuation) {
    reject(new TypeError("Your middleware continuation cannot resolve to itself"));
    return;
  }
  void ReflectApply(PromiseThen, dispatched, [resolve, reject]);
}

function adoptMiddlewareResult(
  result: Promise<AgentResponse>,
  onSettled: () => void,
  beginAdoption: () => void,
  endAdoption: () => void,
): Promise<AgentResponse> {
  if (ReflectApply(WeakSetHas, TRACKED_CONTINUATIONS, [result]) as boolean) {
    ReflectApply(WeakSetAdd, OBSERVED_CONTINUATIONS, [result]);
  }
  return new IntrinsicPromise((resolve, reject) => {
    beginAdoption();
    try {
      void ReflectApply(PromiseThen, result, [
        (value: AgentResponse) => {
          onSettled();
          resolve(value);
        },
        (error: unknown) => {
          onSettled();
          reject(error);
        },
      ]);
    } finally {
      endAdoption();
    }
  });
}

function createInvalidContinuationError() {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  ReflectApply(WeakSetAdd, INVALID_CONTINUATION_ERRORS, [error]);
  try {
    ObjectDefineProperty(error, INVALID_CONTINUATION_MARKER, { value: true });
  } catch {
    // The WeakSet remains the local fallback if the error is not extensible.
  }
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (ReflectApply(WeakSetHas, INVALID_CONTINUATION_ERRORS, [error]) as boolean) return true;
  if (!canIdentifyProxyWithoutHooks) return false;
  if (isProxyWithoutHooks(error)) return false;
  try {
    return ObjectGetOwnPropertyDescriptor(error, INVALID_CONTINUATION_MARKER)?.value === true;
  } catch {
    return false;
  }
}

function isAbortError(error: unknown): boolean {
  try {
    if (isProxyWithoutHooks(error)) return false;
    if (typeof DOM_EXCEPTION_NAME_GETTER === "function") {
      try {
        return ReflectApply(DOM_EXCEPTION_NAME_GETTER, error, []) === "AbortError";
      } catch {
        // The native Web IDL getter rejects non-DOMException values without
        // consulting their prototype chain.
      }
    }
    if (isNativeErrorWithoutHooks(error)) {
      return readNativeErrorNameWithoutHooks(error) === "AbortError";
    }
    return false;
  } catch {
    return false;
  }
}

function observeContinuationRejection(
  promise: Promise<unknown>,
  onUnexpectedRejection?: ContinuationRejectionHandler,
  isObserved: () => boolean = () => false,
  suppressedInvalidErrors?: WeakSet<object>,
): void {
  void ReflectApply(PromiseThen, promise, [undefined, (error: unknown) => {
    try {
      if (
        typeof error === "object" && error !== null && suppressedInvalidErrors &&
        isInvalidContinuationError(error) &&
        ReflectApply(WeakSetHas, suppressedInvalidErrors, [error]) as boolean
      ) {
        return;
      }
      if (isAbortError(error)) return;
      onUnexpectedRejection?.(error, isObserved);
    } catch {
      // Rejection observers must not create a second unhandled rejection.
    }
  }]);
}

function reportDetachedContinuationFailure(error: unknown): void {
  agentLogger.error(
    "Your agent middleware continuation failed",
    {
      failure: DETACHED_CONTINUATION_FAILURE,
      failure_type: classifyContinuationFailure(error),
    },
  );
}

function classifyContinuationFailure(error: unknown): string {
  if (error === null) return "null";
  if (isProxyWithoutHooks(error)) return "proxy";
  if (typeof DOM_EXCEPTION_NAME_GETTER === "function") {
    try {
      ReflectApply(DOM_EXCEPTION_NAME_GETTER, error, []);
      return "domexception";
    } catch {
      // The native getter is a side-effect-free DOMException brand check.
    }
  }
  if (isNativeErrorWithoutHooks(error)) {
    const name = readNativeErrorNameWithoutHooks(error);
    switch (name) {
      case "AggregateError":
      case "DOMException":
      case "Error":
      case "EvalError":
      case "RangeError":
      case "ReferenceError":
      case "SyntaxError":
      case "TypeError":
      case "URIError":
        return name.toLowerCase();
      default:
        return "error";
    }
  }
  switch (typeof error) {
    case "bigint":
    case "boolean":
    case "number":
    case "string":
    case "symbol":
    case "undefined":
      return "primitive";
    default:
      return "object";
  }
}

function scheduleDetachedContinuationFailureReport(record: {
  error: unknown;
  isObserved: () => boolean;
  reported: boolean;
}): void {
  setTimeout(() => {
    try {
      if (!record.isObserved() && !record.reported) {
        record.reported = true;
        reportDetachedContinuationFailure(record.error);
      }
    } catch {
      // A diagnostic callback must not become a new unhandled failure.
    }
  }, 0);
}

function rejectInvalidContinuation(
  onUnexpectedRejection?: ContinuationRejectionHandler,
): Promise<AgentResponse> {
  const suppressedInvalidErrors = new IntrinsicWeakSet<object>();
  return createObservedContinuation<AgentResponse>(
    (_resolve, reject) => {
      const error = createInvalidContinuationError();
      ReflectApply(WeakSetAdd, suppressedInvalidErrors, [error]);
      reject(error);
    },
    onUnexpectedRejection,
    suppressedInvalidErrors,
  );
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  onUnexpectedRejection?: ContinuationRejectionHandler,
): Promise<AgentResponse> {
  const suppressedInvalidErrors = new IntrinsicWeakSet<object>();
  const continuation = createObservedContinuation<AgentResponse>(
    (resolve, reject) => {
      const schedulingPromise = ReflectApply(PromiseResolve, IntrinsicPromise, []);
      const scheduled = ReflectApply(PromiseThen, schedulingPromise, [() => {
        if (isSettled()) {
          const error = createInvalidContinuationError();
          ReflectApply(WeakSetAdd, suppressedInvalidErrors, [error]);
          reject(error);
          return;
        }
        adoptContinuationResult(dispatch, resolve, reject, continuation);
      }]);
      void ReflectApply(PromiseThen, scheduled, [undefined, reject]);
    },
    onUnexpectedRejection,
    suppressedInvalidErrors,
  );
  return continuation;
}

interface MiddlewareContinuation {
  next: () => Promise<AgentResponse>;
  beginAdoption: () => void;
  endAdoption: () => void;
  finishInvocation: () => void;
  settle: () => void;
}

function createMiddlewareContinuation(
  dispatch: () => Promise<AgentResponse>,
): MiddlewareContinuation {
  let nextCalled = false;
  let middlewareInvoking = true;
  let middlewareAdopting = false;
  let middlewareSettled = false;

  const reportContinuationFailure = (error: unknown, isObserved: () => boolean): void => {
    if (!middlewareSettled) {
      if (!isObserved()) {
        const record = { error, isObserved, reported: false };
        scheduleDetachedContinuationFailureReport(record);
      }
      return;
    }
    if (isObserved()) return;
    scheduleDetachedContinuationFailureReport({ error, isObserved, reported: false });
  };

  const next = (): Promise<AgentResponse> => {
    if (nextCalled || middlewareAdopting || middlewareSettled) {
      return rejectInvalidContinuation(reportContinuationFailure);
    }
    nextCalled = true;

    if (!middlewareInvoking) {
      return createDeferredContinuation(
        () => middlewareSettled,
        dispatch,
        reportContinuationFailure,
      );
    }

    // Preserve the dispatched Promise identity so native cycle detection still
    // rejects a downstream handler that returns its own eager continuation.
    return trackEagerContinuation(dispatch(), reportContinuationFailure);
  };

  return {
    next,
    beginAdoption: () => {
      middlewareAdopting = true;
    },
    endAdoption: () => {
      middlewareAdopting = false;
    },
    finishInvocation: () => {
      middlewareInvoking = false;
    },
    settle: () => {
      middlewareInvoking = false;
      middlewareSettled = true;
    },
  };
}

export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = middleware;
  }

  execute(
    context: AgentContext,
    finalHandler: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    return withSpan(
      "agent.middleware.chain.execute",
      () => {
        const dispatch = (middlewareIndex: number): Promise<AgentResponse> => {
          const currentMiddleware = this.middleware[middlewareIndex];

          if (!currentMiddleware) return finalHandler();

          let middlewareResult: Promise<AgentResponse> | undefined;
          const tracedResult = withSpan(
            `agent.middleware.chain.dispatch.${middlewareIndex + 1}`,
            async () => {
              const continuation = createMiddlewareContinuation(
                () => dispatch(middlewareIndex + 1),
              );

              try {
                middlewareResult = currentMiddleware(context, continuation.next);
                continuation.finishInvocation();
                return await adoptMiddlewareResult(
                  middlewareResult,
                  continuation.settle,
                  continuation.beginAdoption,
                  continuation.endAdoption,
                );
              } finally {
                continuation.settle();
              }
            },
            { "middleware.index": middlewareIndex },
          );
          if (!middlewareResult) return tracedResult;
          observeContinuationRejection(tracedResult);
          return middlewareResult;
        };

        return dispatch(0);
      },
      { "middleware.count": this.middleware.length },
    );
  }

  use(middleware: AgentMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  prepend(middleware: AgentMiddleware): this {
    this.middleware.unshift(middleware);
    return this;
  }

  get length(): number {
    return this.middleware.length;
  }

  isEmpty(): boolean {
    return this.middleware.length === 0;
  }
}

export function createMiddlewareChain(
  middleware?: AgentMiddleware[],
): MiddlewareChain {
  return new MiddlewareChain(middleware);
}
