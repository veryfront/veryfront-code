import type { ExecutionContext, MiddlewareHandler } from "../types.ts";
import type { MiddlewarePipelineOptions } from "./types.ts";
import { composeMiddleware } from "./composer.ts";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

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
    req: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: RuntimeAdapter,
  ): Promise<Response> {
    return executeMiddlewarePipeline(
      req,
      this.compose(),
      env,
      executionCtx,
      adapter,
    );
  }

  /**
   * Run the middleware pipeline with a final request handler.
   * Unlike {@link execute}, which returns a 404 when no middleware responds,
   * `handle` invokes the given handler as the terminal step so middleware
   * can add headers, validate auth, etc. before the handler runs.
   *
   * ```ts
   * const pipeline = new MiddlewarePipeline().use(cors({ origin: "*" }));
   * export function GET(req: Request) {
   *   return pipeline.handle(req, () =>
   *     Response.json({ ok: true })
   *   );
   * }
   * ```
   */
  handle(
    req: Request,
    handler: (req: Request) => Response | Promise<Response>,
  ): Promise<Response> {
    return executeMiddlewarePipeline(
      req,
      this.compose(),
      undefined,
      undefined,
      undefined,
      handler,
    );
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
    return this.middlewares.map((mw, order) => ({
      name: mw.name ?? "anonymous",
      order,
    }));
  }
}
