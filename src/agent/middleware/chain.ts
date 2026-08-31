import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "Agent middleware next() can only be called once while middleware is active";

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

              const createInvalidContinuationError = (): Error =>
                MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });

              const consumeRejectedPromise = (promise: Promise<AgentResponse>): void => {
                void promise.then(
                  () => undefined,
                  () => undefined,
                );
              };

              const rejectInvalidContinuation = (): Promise<AgentResponse> => {
                const rejection = Promise.reject<AgentResponse>(createInvalidContinuationError());
                consumeRejectedPromise(rejection);
                return rejection;
              };

              const next = (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;

                if (!middlewareInvoking) {
                  const deferredContinuation = new Promise<AgentResponse>((resolve, reject) => {
                    queueMicrotask(() => {
                      if (middlewareSettled) {
                        reject(createInvalidContinuationError());
                        consumeRejectedPromise(deferredContinuation);
                        return;
                      }

                      try {
                        void dispatch(middlewareIndex + 1).then(resolve, reject);
                      } catch (error) {
                        reject(error);
                      }
                    });
                  });
                  return deferredContinuation;
                }

                return dispatch(middlewareIndex + 1);
              };

              try {
                const result = currentMiddleware(context, next);
                middlewareInvoking = false;
                return await result;
              } finally {
                middlewareInvoking = false;
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
