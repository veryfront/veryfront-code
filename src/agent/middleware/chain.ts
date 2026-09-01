import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";

class InvalidContinuationPromise extends Promise<AgentResponse> {
  override then<TResult1 = AgentResponse, TResult2 = never>(
    onFulfilled?:
      | ((value: AgentResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    const derived = Promise.prototype.then.call(
      this,
      onFulfilled,
      onRejected,
    ) as Promise<TResult1 | TResult2>;
    void Promise.prototype.then.call(derived, undefined, () => undefined);
    return derived;
  }
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = new InvalidContinuationPromise(
    (_resolve, reject) =>
      reject(MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE })),
  );
  void Promise.prototype.then.call(rejection, undefined, () => undefined);
  return rejection;
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
              const next = (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;
                if (!middlewareInvoking) {
                  return Promise.resolve().then(() => {
                    if (middlewareSettled) return rejectInvalidContinuation();
                    return dispatch(middlewareIndex + 1);
                  });
                }
                return dispatch(middlewareIndex + 1);
              };

              try {
                const result = currentMiddleware(context, next);
                middlewareInvoking = false;
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
