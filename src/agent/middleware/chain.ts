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

              const rejectInvalidContinuation = (): Promise<AgentResponse> =>
                Promise.reject(MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE }));

              const next = (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;

                if (!middlewareInvoking) {
                  return Promise.resolve().then(() => {
                    if (middlewareSettled) {
                      throw MIDDLEWARE_ERROR.create({
                        message: INVALID_CONTINUATION_MESSAGE,
                      });
                    }
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
