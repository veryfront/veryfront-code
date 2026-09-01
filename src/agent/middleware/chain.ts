import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR, type VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const IntrinsicPromiseThen = Promise.prototype.then;
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();

function createInvalidContinuationError(): VeryfrontError {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  INVALID_CONTINUATION_ERRORS.add(error);
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && INVALID_CONTINUATION_ERRORS.has(error);
}

function containRejection(promise: Promise<unknown>): void {
  void IntrinsicPromiseThen.call(promise, undefined, () => undefined);
}

class InvalidContinuationPromise extends Promise<AgentResponse> {
  override then<TResult1 = AgentResponse, TResult2 = never>(
    onFulfilled?:
      | ((value: AgentResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    const derived = IntrinsicPromiseThen.call(
      this,
      onFulfilled,
      onRejected,
    ) as Promise<TResult1 | TResult2>;
    containRejection(derived);
    return derived;
  }
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = new InvalidContinuationPromise(
    (_resolve, reject) => reject(createInvalidContinuationError()),
  );
  containRejection(rejection);
  return rejection;
}

class DeferredContinuationPromise extends Promise<AgentResponse> {
  private settlement: "pending" | "valid" | "invalid" = "pending";
  private readonly derived = new Set<Promise<unknown>>();

  override then<TResult1 = AgentResponse, TResult2 = never>(
    onFulfilled?:
      | ((value: AgentResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    const derived = IntrinsicPromiseThen.call(
      this,
      onFulfilled,
      onRejected,
    ) as Promise<TResult1 | TResult2>;
    if (this.settlement === "invalid") {
      containRejection(derived);
    } else if (this.settlement === "pending") {
      this.derived.add(derived);
    }
    return derived;
  }

  markSettled(error: unknown): void {
    if (this.settlement !== "pending") return;
    this.settlement = isInvalidContinuationError(error) ? "invalid" : "valid";
    if (this.settlement === "invalid") {
      for (const derived of this.derived) containRejection(derived);
    }
    this.derived.clear();
  }
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
): Promise<AgentResponse> {
  const continuation = new DeferredContinuationPromise((resolve, reject) => {
    const scheduled = Promise.resolve().then(() => {
      if (isSettled()) {
        const error = createInvalidContinuationError();
        continuation.markSettled(error);
        reject(error);
        containRejection(continuation);
        return;
      }
      void IntrinsicPromiseThen.call(
        dispatch(),
        (value: AgentResponse) => {
          continuation.markSettled(undefined);
          resolve(value);
        },
        (error: unknown) => {
          continuation.markSettled(error);
          reject(error);
          if (isInvalidContinuationError(error)) containRejection(continuation);
        },
      );
    });
    void IntrinsicPromiseThen.call(scheduled, undefined, (error: unknown) => {
      continuation.markSettled(error);
      reject(error);
      if (isInvalidContinuationError(error)) containRejection(continuation);
    });
  });
  return continuation;
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
              let nextCalled = false;
              let middlewareInvoking = true;
              let middlewareSettled = false;
              let middlewareResultSettled = false;
              const next = (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled || middlewareResultSettled) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;
                if (!middlewareInvoking) {
                  return createDeferredContinuation(
                    () => middlewareSettled || middlewareResultSettled,
                    () => dispatch(middlewareIndex + 1),
                  );
                }
                return dispatch(middlewareIndex + 1);
              };

              try {
                const result = currentMiddleware(context, next);
                middlewareInvoking = false;
                void IntrinsicPromiseThen.call(
                  result,
                  () => {
                    middlewareResultSettled = true;
                  },
                  () => {
                    middlewareResultSettled = true;
                  },
                );
                return await result;
              } finally {
                middlewareSettled = true;
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
