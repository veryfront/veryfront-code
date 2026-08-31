import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  isErrorAcrossRealms,
  readNativeErrorNameWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const DETACHED_CONTINUATION_FAILURE = "downstream continuation rejected";
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();

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
  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  constructor(
    executor: ContinuationExecutor<T>,
    private readonly onObserved: () => void,
    private readonly onRejection?: ContinuationRejectionHandler,
  ) {
    super(executor);
  }

  override then<TResult1 = T, TResult2 = never>( // NOSONAR: tracks Promise observation for detached-error diagnostics.
    onFulfilled?: ContinuationThenHandler<T, TResult1>,
    onRejected?: ContinuationThenHandler<unknown, TResult2>,
  ): Promise<TResult1 | TResult2> {
    this.onObserved();
    const derived = super.then(onFulfilled, onRejected);
    if (!this.onRejection) return derived;
    return createObservedContinuation<TResult1 | TResult2>((resolve, reject) => {
      void Promise.prototype.then.call(derived, resolve, reject);
    }, this.onRejection);
  }
}

function createObservedContinuation<T>(
  executor: ContinuationExecutor<T>,
  onRejection?: ContinuationRejectionHandler,
): Promise<T> {
  let observed = false;
  const continuation = new ObservedContinuationPromise<T>(
    executor,
    () => {
      observed = true;
    },
    onRejection,
  );
  if (onRejection) {
    observeContinuationRejection(
      continuation,
      onRejection,
      () => observed,
    );
  }
  return continuation;
}

function adoptContinuationResult(
  dispatch: () => Promise<AgentResponse>,
  resolve: (value: AgentResponse | PromiseLike<AgentResponse>) => void,
  reject: (reason?: unknown) => void,
): void {
  const dispatched = dispatch();
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
    return isErrorAcrossRealms(error) && readNativeErrorNameWithoutHooks(error) === "AbortError";
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

function reportDetachedContinuationFailure(): void {
  agentLogger.error(
    "Your agent middleware continuation failed",
    { error: DETACHED_CONTINUATION_FAILURE },
  );
}

function scheduleDetachedContinuationFailureReport(isObserved: () => boolean): void {
  queueMicrotask(() => {
    if (!isObserved()) reportDetachedContinuationFailure();
  });
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  return createObservedContinuation<AgentResponse>((_resolve, reject) => {
    reject(createInvalidContinuationError());
  }, () => {});
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
      adoptContinuationResult(dispatch, resolve, reject);
    }).catch(reject);
  }, onUnexpectedRejection);
  return continuation;
}

interface MiddlewareContinuation {
  next: () => Promise<AgentResponse>;
  finishInvocation: () => void;
  settle: (error?: unknown) => void;
}

function createMiddlewareContinuation(
  dispatch: () => Promise<AgentResponse>,
): MiddlewareContinuation {
  let nextCalled = false;
  let middlewareInvoking = true;
  let middlewareSettled = false;
  let middlewareSettlementError: unknown;
  let continuationRejection:
    | { error: unknown; isObserved: () => boolean }
    | undefined;

  const reportContinuationFailure = (error: unknown, isObserved: () => boolean): void => {
    if (!middlewareSettled) {
      if (!isObserved()) continuationRejection = { error, isObserved };
      return;
    }
    if (isObserved() || middlewareSettlementError === error) return;
    scheduleDetachedContinuationFailureReport(isObserved);
  };

  const next = (): Promise<AgentResponse> => {
    if (nextCalled || middlewareSettled) return rejectInvalidContinuation();
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
    settle: (error?: unknown) => {
      middlewareInvoking = false;
      middlewareSettled = true;
      middlewareSettlementError = error;
      const rejection = continuationRejection;
      continuationRejection = undefined;
      if (rejection && !rejection.isObserved() && middlewareSettlementError !== rejection.error) {
        scheduleDetachedContinuationFailureReport(rejection.isObserved);
      }
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

              let middlewareError: unknown;
              try {
                const result = currentMiddleware(context, continuation.next);
                continuation.finishInvocation();
                return await result;
              } catch (error) {
                middlewareError = error;
                throw error;
              } finally {
                continuation.settle(middlewareError);
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
