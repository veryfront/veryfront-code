import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = [...middleware];
  }

  execute(
    context: AgentContext,
    finalHandler: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    return withSpan(
      "agent.middleware.chain.execute",
      () => {
        const middleware = [...this.middleware];
        let lastDispatchedIndex = -1;

        const dispatch = (middlewareIndex: number): Promise<AgentResponse> => {
          if (middlewareIndex <= lastDispatchedIndex) {
            return Promise.reject(new Error("Agent middleware next() called multiple times"));
          }
          lastDispatchedIndex = middlewareIndex;
          const currentMiddleware = middleware[middlewareIndex];

          if (!currentMiddleware) return finalHandler();

          return withSpan(
            `agent.middleware.chain.dispatch.${middlewareIndex + 1}`,
            () => currentMiddleware(context, () => dispatch(middlewareIndex + 1)),
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
