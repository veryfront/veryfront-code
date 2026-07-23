import type {
  ExecutionContext,
  MiddlewareExecutionAdapter,
  MiddlewareHandler,
  RuntimeMiddlewareHandler,
} from "../types.ts";
import type { MiddlewarePipelineOptions } from "./types.ts";
import { composeMiddleware } from "./composer.ts";
import { executeMiddlewarePipeline } from "./executor.ts";
import type { RuntimeRequestHandler, RuntimeResponse } from "#veryfront/platform/adapters/base.ts";
import { serverLogger } from "#veryfront/utils";

type PipelineMiddleware = MiddlewareHandler | RuntimeMiddlewareHandler;

function assertPipelineOptions(options: unknown): asserts options is MiddlewarePipelineOptions {
  if (
    options === null || typeof options !== "object" || Array.isArray(options) ||
    Reflect.ownKeys(options).length > 0
  ) {
    throw new TypeError("MiddlewarePipeline does not accept options");
  }
}

class MiddlewarePipelineEngine {
  private middlewares: RuntimeMiddlewareHandler[] = [];
  private teardownCallbacks: Array<() => void | Promise<void>> = [];
  private registry: Array<{ pattern: RegExp; use: RuntimeMiddlewareHandler[] }> = [];

  constructor(options: MiddlewarePipelineOptions) {
    assertPipelineOptions(options);
  }

  use(middleware: PipelineMiddleware): void {
    if (typeof middleware !== "function") {
      throw new TypeError("middleware must be a function");
    }
    this.middlewares.push(middleware as RuntimeMiddlewareHandler);
  }

  useFor(pattern: RegExp, handlers: PipelineMiddleware[]): void {
    if (!(pattern instanceof RegExp)) {
      throw new TypeError("middleware pattern must be a RegExp");
    }
    if (handlers.length === 0) {
      throw new TypeError("useFor requires at least one middleware");
    }
    if (handlers.some((handler) => typeof handler !== "function")) {
      throw new TypeError("middleware must be a function");
    }
    this.registry.push({
      pattern: new RegExp(pattern.source, pattern.flags),
      use: handlers.map((handler) => handler as RuntimeMiddlewareHandler),
    });
  }

  onTeardown(cb: () => void | Promise<void>): void {
    if (typeof cb !== "function") {
      throw new TypeError("teardown callback must be a function");
    }
    this.teardownCallbacks.push(cb);
  }

  compose(): RuntimeMiddlewareHandler {
    return composeMiddleware(this.middlewares, this.registry);
  }

  execute(
    req: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: MiddlewareExecutionAdapter,
  ): Promise<RuntimeResponse> {
    return executeMiddlewarePipeline(
      req,
      this.compose(),
      env,
      executionCtx,
      adapter,
    );
  }

  handle(
    req: Request,
    handler: RuntimeRequestHandler,
  ): Promise<RuntimeResponse> {
    if (typeof handler !== "function") {
      throw new TypeError("handler must be a function");
    }
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
        serverLogger.warn("middleware teardown failed", {
          errorName: e instanceof Error ? e.name : typeof e,
        });
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

/** Compose and execute request middleware that returns standard web responses. */
export class MiddlewarePipeline {
  readonly #engine: MiddlewarePipelineEngine;

  /** Create an empty middleware pipeline. */
  constructor(options: MiddlewarePipelineOptions = {}) {
    this.#engine = new MiddlewarePipelineEngine(options);
  }

  /** Append middleware to every request. */
  use(middleware: MiddlewareHandler): this {
    this.#engine.use(middleware);
    return this;
  }

  /** Append middleware for requests whose path matches a regular expression. */
  useFor(pattern: RegExp, ...handlers: MiddlewareHandler[]): this {
    this.#engine.useFor(pattern, handlers);
    return this;
  }

  /** Register a callback that runs once during pipeline teardown. */
  onTeardown(cb: () => void | Promise<void>): this {
    this.#engine.onTeardown(cb);
    return this;
  }

  /** Compose registered middleware into one reusable handler. */
  compose(): MiddlewareHandler {
    return this.#engine.compose() as unknown as MiddlewareHandler;
  }

  /** Execute middleware and return 404 if no middleware responds. */
  execute(
    req: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: MiddlewareExecutionAdapter,
  ): Promise<Response> {
    return this.#engine.execute(req, env, executionCtx, adapter) as Promise<Response>;
  }

  /**
   * Run the middleware pipeline with a final request handler.
   * Unlike `execute`, which returns a 404 when no middleware responds,
   * `handle` invokes the given handler as the terminal step so middleware
   * can add headers or validate access before the handler runs.
   *
   * ```ts
   * const pipeline = new MiddlewarePipeline().use(cors({ origin: "*" }));
   * export function GET(req: Request) {
   *   return pipeline.handle(req, () => Response.json({ ok: true }));
   * }
   * ```
   */
  handle(
    req: Request,
    handler: (req: Request) => Response | Promise<Response>,
  ): Promise<Response> {
    return this.#engine.handle(req, handler) as Promise<Response>;
  }

  /** Run and clear registered teardown callbacks. */
  teardown(): Promise<void> {
    return this.#engine.teardown();
  }

  /** List globally registered middleware in execution order. */
  getMiddleware(): Array<{ name?: string; order?: number }> {
    return this.#engine.getMiddleware();
  }
}

/** Internal pipeline that preserves platform-specific upgrade responses. */
export class RuntimeMiddlewarePipeline {
  readonly #engine: MiddlewarePipelineEngine;

  constructor(options: MiddlewarePipelineOptions = {}) {
    this.#engine = new MiddlewarePipelineEngine(options);
  }

  use(middleware: MiddlewareHandler): this;
  use(middleware: RuntimeMiddlewareHandler): this;
  use(middleware: PipelineMiddleware): this {
    this.#engine.use(middleware);
    return this;
  }

  useFor(pattern: RegExp, ...handlers: MiddlewareHandler[]): this;
  useFor(pattern: RegExp, ...handlers: RuntimeMiddlewareHandler[]): this;
  useFor(pattern: RegExp, ...handlers: PipelineMiddleware[]): this {
    this.#engine.useFor(pattern, handlers);
    return this;
  }

  onTeardown(cb: () => void | Promise<void>): this {
    this.#engine.onTeardown(cb);
    return this;
  }

  compose(): RuntimeMiddlewareHandler {
    return this.#engine.compose();
  }

  execute(
    req: Request,
    env?: Record<string, unknown>,
    executionCtx?: ExecutionContext,
    adapter?: MiddlewareExecutionAdapter,
  ): Promise<RuntimeResponse> {
    return this.#engine.execute(req, env, executionCtx, adapter);
  }

  handle(req: Request, handler: RuntimeRequestHandler): Promise<RuntimeResponse> {
    return this.#engine.handle(req, handler);
  }

  teardown(): Promise<void> {
    return this.#engine.teardown();
  }

  getMiddleware(): Array<{ name?: string; order?: number }> {
    return this.#engine.getMiddleware();
  }
}
