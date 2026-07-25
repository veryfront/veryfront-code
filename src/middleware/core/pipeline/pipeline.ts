import type { ExecutionContext, MiddlewareHandler } from "../types.ts";
import type { MiddlewarePipelineOptions } from "./types.ts";
import { composeMiddleware } from "./composer.ts";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";

/** Implement middleware pipeline. */
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
    try {
      return await executeMiddlewarePipeline(
        req,
        this.compose(),
        env,
        executionCtx,
        adapter,
      );
    } finally {
      await this.runTeardownCallbacks();
    }
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
  async handle(
    req: Request,
    handler: (req: Request) => Response | Promise<Response>,
  ): Promise<Response> {
    try {
      return await executeMiddlewarePipeline(
        req,
        this.compose(),
        undefined,
        undefined,
        undefined,
        handler,
      );
    } finally {
      await this.runTeardownCallbacks();
    }
  }

  /**
   * Run every registered teardown callback once, in registration order,
   * without discarding them, so a module-scoped route pipeline fires them
   * again on the next request. Called by {@link execute} and {@link handle}
   * after the response is produced. Callback errors are logged and swallowed
   * so cleanup failures never surface to the client.
   */
  private async runTeardownCallbacks(): Promise<void> {
    for (const cb of this.teardownCallbacks) {
      try {
        await cb();
      } catch (e) {
        serverLogger.warn("middleware teardown failed", e);
      }
    }
  }

  /**
   * Drain and discard all registered teardown callbacks. Unlike the
   * per-request cleanup run by {@link execute} / {@link handle}, this clears
   * the callbacks so they never run again. Use it for one-shot lifecycle
   * cleanup, e.g. draining a long-lived pipeline on server shutdown.
   */
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
