import type { ExecutionContext, MiddlewareHandler } from "../types.ts";
import type { MiddlewarePipelineOptions } from "./types.ts";
import { composeMiddleware } from "./composer.ts";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";

export class MiddlewarePipeline {
  private middlewares: MiddlewareHandler[] = [];
  private teardownCallbacks: Array<() => void | Promise<void>> = [];
  private registry: Array<{ pattern: RegExp; use: MiddlewareHandler[] }> = [];

  constructor(_options: MiddlewarePipelineOptions = {}) {}

  use(middleware: MiddlewareHandler): this {
    this.middlewares.push(middleware);
    return this;
  }

  useFor(pattern: RegExp, ...handlers: MiddlewareHandler[]): this {
    this.registry.push({ pattern, use: handlers });
    return this;
  }

  onTeardown(cb: () => void | Promise<void>): this {
    this.teardownCallbacks.push(cb);
    return this;
  }

  compose(): MiddlewareHandler {
    return composeMiddleware(this.middlewares, this.registry);
  }

  async execute(
    req: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: RuntimeAdapter,
  ): Promise<Response> {
    const composed = this.compose();
    return await executeMiddlewarePipeline(req, composed, env, executionCtx, adapter);
  }

  async teardown(): Promise<void> {
    for (const cb of this.teardownCallbacks) {
      try {
        await cb();
      } catch (e) {
        const { serverLogger } = await import("../../../core/utils/logger/logger.ts");
        serverLogger.warn("middleware teardown failed", e);
      }
    }
    this.teardownCallbacks = [];
  }

  getMiddleware(): Array<{ name?: string; order?: number }> {
    return this.middlewares.map((mw, index) => ({
      name: mw.name || "anonymous",
      order: index,
    }));
  }
}
