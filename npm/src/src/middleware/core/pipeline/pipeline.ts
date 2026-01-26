import * as dntShim from "../../../../_dnt.shims.js";
import type { ExecutionContext, MiddlewareHandler } from "../types.js";
import type { MiddlewarePipelineOptions } from "./types.js";
import { composeMiddleware } from "./composer.js";
import { executeMiddlewarePipeline } from "./executor.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { serverLogger } from "../../../utils/logger/logger.js";

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

  execute(
    req: dntShim.Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: RuntimeAdapter,
  ): Promise<dntShim.Response> {
    const handler = this.compose();
    return executeMiddlewarePipeline(req, handler, env, executionCtx, adapter);
  }

  async teardown(): Promise<void> {
    const callbacks = this.teardownCallbacks;
    this.teardownCallbacks = [];

    for (const cb of callbacks) {
      try {
        await cb();
      } catch (e) {
        serverLogger.warn("middleware teardown failed", e);
      }
    }
  }

  getMiddleware(): Array<{ name?: string; order?: number }> {
    return this.middlewares.map((mw, index) => ({
      name: mw.name ?? "anonymous",
      order: index,
    }));
  }
}
