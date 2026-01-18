/**
 * Middleware Chain
 *
 * Executes middleware in order, allowing each to modify context, response,
 * or short-circuit by not calling next().
 *
 * @module veryfront/agent/middleware
 */

import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";

/**
 * Middleware chain executor
 */
export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = middleware;
  }

  execute(
    context: AgentContext,
    finalHandler: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    let index = 0;

    const dispatch = (): Promise<AgentResponse> => {
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
