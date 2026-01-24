import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
        let index = 0;

        const dispatch = (): Promise<AgentResponse> => {
          const middlewareIndex = index++;
          const currentMiddleware = this.middleware[middlewareIndex];

          if (!currentMiddleware) {
            return finalHandler();
          }

          return withSpan(
            `agent.middleware.chain.dispatch.${index}`,
            () => currentMiddleware(context, dispatch),
            { "middleware.index": middlewareIndex },
          );
        };

        return dispatch();
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
