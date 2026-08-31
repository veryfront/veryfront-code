import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const DETACHED_CONTINUATION_FAILURE = "downstream continuation rejected";
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();

type ContinuationThenHandler<T, R> =
  | ((value: T) => R | PromiseLike<R>)
  | null
  | undefined;

type ContinuationExecutor = (
  resolve: (value: AgentResponse | PromiseLike<AgentResponse>) => void,
  reject: (reason?: unknown) => void,
) => void;

class ObservedContinuationPromise extends Promise<AgentResponse> {
  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }

  constructor(
    executor: ContinuationExecutor,
    private readonly onObserved: () => void,
  ) {
    super(executor);
  }

  override then<TResult1 = AgentResponse, TResult2 = never>( // NOSONAR: tracks Promise observation for detached-error diagnostics.
    onFulfilled?: ContinuationThenHandler<AgentResponse, TResult1>,
    onRejected?: ContinuationThenHandler<unknown, TResult2>,
  ): Promise<TResult1 | TResult2> {
    this.onObserved();
    return super.then(onFulfilled, onRejected);
  }
}

function createObservedContinuation(
  executor: ContinuationExecutor,
  onObserved: () => void,
): Promise<AgentResponse> {
  return new ObservedContinuationPromise(executor, onObserved);
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
  return error instanceof Error && error.name === "AbortError";
}

function observeContinuationRejection(
  promise: Promise<AgentResponse>,
  onUnexpectedRejection?: (error: unknown) => void,
): void {
  void Promise.prototype.then.call(promise, undefined, (error: unknown) => {
    if (isInvalidContinuationError(error) || isAbortError(error)) return;
    onUnexpectedRejection?.(error);
  });
}

function reportDetachedContinuationFailure(): void {
  agentLogger.error(
    "Your agent middleware continuation failed",
    { error: DETACHED_CONTINUATION_FAILURE },
  );
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = Promise.reject<AgentResponse>(createInvalidContinuationError());
  observeContinuationRejection(rejection);
  return rejection;
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  onUnexpectedRejection?: (error: unknown) => void,
  onObserved?: () => void,
): Promise<AgentResponse> {
  const continuation = createObservedContinuation((resolve, reject) => {
    void Promise.resolve().then(() => {
      if (isSettled()) {
        reject(createInvalidContinuationError());
        return;
      }
      adoptContinuationResult(dispatch, resolve, reject);
    }).catch(reject);
  }, onObserved ?? (() => {}));
  observeContinuationRejection(continuation, onUnexpectedRejection);
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
  let continuationObserved = false;
  let continuationRejection: { error: unknown } | undefined;

  const reportContinuationFailure = (error: unknown): void => {
    if (!middlewareSettled) {
      if (!continuationObserved) continuationRejection = { error };
      return;
    }
    if (continuationObserved || middlewareSettlementError === error) return;
    reportDetachedContinuationFailure();
  };

  const next = (): Promise<AgentResponse> => {
    if (nextCalled || middlewareSettled) return rejectInvalidContinuation();
    nextCalled = true;

    if (!middlewareInvoking) {
      return createDeferredContinuation(
        () => middlewareSettled,
        dispatch,
        reportContinuationFailure,
        () => {
          continuationObserved = true;
        },
      );
    }

    const continuation = createObservedContinuation((resolve, reject) => {
      adoptContinuationResult(dispatch, resolve, reject);
    }, () => {
      continuationObserved = true;
    });
    observeContinuationRejection(continuation, reportContinuationFailure);
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
      if (rejection && !continuationObserved && middlewareSettlementError !== rejection.error) {
        reportDetachedContinuationFailure();
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
