import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const DETACHED_CONTINUATION_FAILURE = "downstream continuation rejected";
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();
const DOM_EXCEPTION_NAME_GETTER = typeof DOMException === "function"
  ? Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get
  : undefined;

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
  private observed = false;

  constructor(
    executor: ContinuationExecutor<T>,
    private readonly onRejection?: ContinuationRejectionHandler,
  ) {
    super(executor);
  }

  override then<TResult1 = T, TResult2 = never>( // NOSONAR: tracks Promise observation for detached-error diagnostics.
    onFulfilled?: ContinuationThenHandler<T, TResult1>,
    onRejected?: ContinuationThenHandler<unknown, TResult2>,
  ): Promise<TResult1 | TResult2> {
    this.observed = true;
    const derived = super.then(onFulfilled, onRejected);
    if (this.onRejection) {
      const observedDerived = derived as ObservedContinuationPromise<TResult1 | TResult2>;
      observeContinuationRejection(
        derived,
        this.onRejection,
        () => {
          // Keep a safe fallback if a future engine stops honoring Promise
          // species: report rather than suppress a derived rejection.
          return typeof observedDerived.isObserved === "function" &&
            observedDerived.isObserved();
        },
      );
    }
    return derived;
  }

  isObserved(): boolean {
    return this.observed;
  }
}

function createObservedContinuation<T>(
  executor: ContinuationExecutor<T>,
  onRejection?: ContinuationRejectionHandler,
): Promise<T> {
  const continuation = new ObservedContinuationPromise<T>(executor, onRejection);
  if (onRejection) {
    const DerivedContinuationPromise = class extends ObservedContinuationPromise<T> {
      static override get [Symbol.species](): PromiseConstructor {
        return this as PromiseConstructor;
      }

      constructor(derivedExecutor: ContinuationExecutor<T>) {
        super(derivedExecutor, onRejection);
      }
    };
    Object.defineProperty(continuation, "constructor", {
      value: DerivedContinuationPromise,
    });
    observeContinuationRejection(
      continuation,
      onRejection,
      () => continuation.isObserved(),
    );
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
  void Promise.prototype.then.call(dispatched, resolve, reject);
}

function createInvalidContinuationError() {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  INVALID_CONTINUATION_ERRORS.add(error);
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && INVALID_CONTINUATION_ERRORS.has(error);
}

function isAbortError(error: unknown): boolean {
  try {
    if (isProxyWithoutHooks(error)) return false;
    if (typeof DOM_EXCEPTION_NAME_GETTER === "function") {
      try {
        return Reflect.apply(DOM_EXCEPTION_NAME_GETTER, error, []) === "AbortError";
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
): void {
  void Promise.prototype.then.call(promise, undefined, (error: unknown) => {
    try {
      if (isInvalidContinuationError(error) || isAbortError(error)) return;
      onUnexpectedRejection?.(error, isObserved);
    } catch {
      // Rejection observers must not create a second unhandled rejection.
    }
  });
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
  return typeof error;
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
  return createObservedContinuation<AgentResponse>((_resolve, reject) => {
    reject(createInvalidContinuationError());
  }, onUnexpectedRejection);
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  onUnexpectedRejection?: ContinuationRejectionHandler,
): Promise<AgentResponse> {
  const continuation = createObservedContinuation<AgentResponse>((resolve, reject) => {
    void Promise.resolve().then(() => {
      if (isSettled()) {
        reject(createInvalidContinuationError());
        return;
      }
      adoptContinuationResult(dispatch, resolve, reject, continuation);
    }).catch(reject);
  }, onUnexpectedRejection);
  return continuation;
}

interface MiddlewareContinuation {
  next: () => Promise<AgentResponse>;
  finishInvocation: () => void;
  settle: () => void;
}

function createMiddlewareContinuation(
  dispatch: () => Promise<AgentResponse>,
): MiddlewareContinuation {
  let nextCalled = false;
  let middlewareInvoking = true;
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
    if (nextCalled || middlewareSettled) {
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

    const continuation = createObservedContinuation<AgentResponse>((resolve, reject) => {
      adoptContinuationResult(dispatch, resolve, reject);
    }, reportContinuationFailure);
    return continuation;
  };

  return {
    next,
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

          return withSpan(
            `agent.middleware.chain.dispatch.${middlewareIndex + 1}`,
            async () => {
              const continuation = createMiddlewareContinuation(
                () => dispatch(middlewareIndex + 1),
              );

              try {
                const result = currentMiddleware(context, continuation.next);
                continuation.finishInvocation();
                return await result;
              } finally {
                continuation.settle();
              }
            },
            { "middleware.index": middlewareIndex },
          );
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
