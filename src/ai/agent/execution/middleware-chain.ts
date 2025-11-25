/**
 * Middleware Chain
 *
 * Executes a chain of middleware functions for agent requests.
 * Extracted from AgentRuntime to centralize middleware execution logic.
 */

import type { AgentContext, AgentResponse } from "../../types/agent.ts";

/**
 * Middleware function signature
 */
export type AgentMiddleware = (
  context: AgentContext,
  next: () => Promise<AgentResponse>,
) => Promise<AgentResponse>;

/**
 * Middleware chain executor.
 *
 * Executes middleware in order, allowing each to:
 * - Modify the context before execution
 * - Modify the response after execution
 * - Short-circuit the chain by not calling next()
 *
 * Usage:
 * ```ts
 * const chain = new MiddlewareChain([
 *   loggingMiddleware,
 *   authMiddleware,
 *   rateLimitMiddleware,
 * ]);
 *
 * const response = await chain.execute(context, () => agentLoop());
 * ```
 */
export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = middleware;
  }

  /**
   * Execute the middleware chain.
   *
   * @param context - The agent context to pass through middleware
   * @param finalHandler - The final handler to execute after all middleware
   * @returns The agent response after middleware processing
   */
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

  /**
   * Add a middleware to the chain.
   */
  use(middleware: AgentMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Prepend a middleware to the beginning of the chain.
   */
  prepend(middleware: AgentMiddleware): this {
    this.middleware.unshift(middleware);
    return this;
  }

  /**
   * Get the number of middleware in the chain.
   */
  get length(): number {
    return this.middleware.length;
  }

  /**
   * Check if the chain has any middleware.
   */
  isEmpty(): boolean {
    return this.middleware.length === 0;
  }
}

/**
 * Create a new middleware chain.
 */
export function createMiddlewareChain(middleware?: AgentMiddleware[]): MiddlewareChain {
  return new MiddlewareChain(middleware);
}
