
import type { AgentContext, AgentResponse } from "../../types/agent.ts";

export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = middleware;
  }

  execute(
    context: AgentContext,
    finalHandler: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    if (this.middleware.length === 0) {
      return finalHandler();
    }

    let index = 0;

    const dispatch = (): Promise<AgentResponse> => {
      if (index >= this.middleware.length) {
        return finalHandler();
      }

      const currentMiddleware = this.middleware[index++];
      if (!currentMiddleware) {
        return finalHandler();
      }

      return currentMiddleware(context, dispatch);
    };

    return dispatch();
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

export function createMiddlewareChain(middleware?: AgentMiddleware[]): MiddlewareChain {
  return new MiddlewareChain(middleware);
}
