import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";

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
              let middlewareSettled = false;
              const createReplayError = () =>
                MIDDLEWARE_ERROR.create({
                  detail:
                    "Agent middleware next() can only be called once while middleware is active",
                });
              const next = async (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled) {
                  throw createReplayError();
                }
                nextCalled = true;
                await Promise.resolve();
                if (middlewareSettled) {
                  throw createReplayError();
                }
                return dispatch(middlewareIndex + 1);
              };

              try {
                return await currentMiddleware(context, next);
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
