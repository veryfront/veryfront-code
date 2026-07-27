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
    this.requireMiddleware(middleware);
    this.middlewares.push(middleware);
    return this;
  }

  useFor(pattern: RegExp, ...handlers: MiddlewareHandler[]): this {
    if (!(pattern instanceof RegExp)) {
      throw new TypeError("Middleware route pattern must be a RegExp");
    }
    for (const handler of handlers) this.requireMiddleware(handler);
    this.registry.push({ pattern, use: handlers });
    return this;
  }

  onTeardown(cb: () => void | Promise<void>): this {
    if (typeof cb !== "function") {
      throw new TypeError("Middleware teardown callback must be a function");
    }
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
    let middlewareThrew = false;
    const composedMiddleware = this.compose();
    const monitoredMiddleware: MiddlewareHandler = async (context, next) => {
      try {
        return await composedMiddleware(context, next);
      } catch (error) {
        middlewareThrew = true;
        throw error;
      }
    };

    let response: Response;
    try {
      response = await executeMiddlewarePipeline(
        req,
        monitoredMiddleware,
        env,
        executionCtx,
        adapter,
      );
    } catch (error) {
      await this.runTeardownCallbacks();
      throw error;
    }

    return await this.withResponseTeardown(response, { immediate: middlewareThrew });
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
    let middlewareThrew = false;
    const composedMiddleware = this.compose();
    const monitoredMiddleware: MiddlewareHandler = async (context, next) => {
      try {
        return await composedMiddleware(context, next);
      } catch (error) {
        middlewareThrew = true;
        throw error;
      }
    };

    let response: Response;
    try {
      response = await executeMiddlewarePipeline(
        req,
        monitoredMiddleware,
        undefined,
        undefined,
        undefined,
        handler,
      );
    } catch (error) {
      await this.runTeardownCallbacks();
      throw error;
    }

    return await this.withResponseTeardown(response, {
      immediate: middlewareThrew,
    });
  }

  /**
   * Run every registered teardown callback once, in registration order,
   * without discarding them, so a module-scoped route pipeline fires them
   * again on the next request. Called by {@link execute} and {@link handle}:
   * after response bodies close, are canceled, or error; immediately for
   * bodyless, locked, or already-read responses and handler/middleware
   * exceptions. Callback errors are logged and swallowed so cleanup failures
   * never surface to the client. Locked or already-read response bodies cannot
   * be wrapped by the Fetch API, so immediate cleanup is the unavoidable
   * fallback for those invalid response states.
   */
  private async runTeardownCallbacks(): Promise<void> {
    for (const cb of this.teardownCallbacks) {
      try {
        await cb();
      } catch (e) {
        serverLogger.warn("middleware teardown failed", {
          errorName: e instanceof Error ? e.name : typeof e,
        });
      }
    }
  }

  private async withResponseTeardown(
    response: Response,
    options: { immediate: boolean },
  ): Promise<Response> {
    if (this.teardownCallbacks.length === 0) return response;

    const body = response.body;

    if (options.immediate || body === null || body.locked || response.bodyUsed) {
      await this.runTeardownCallbacks();
      return response;
    }

    const wrappedBody = this.wrapBodyWithTeardown(body);
    const wrappedResponse = new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    this.copyResponseMetadata(response, wrappedResponse);
    return wrappedResponse;
  }

  private copyResponseMetadata(source: Response, target: Response): void {
    for (const property of ["url", "redirected", "type"] as const) {
      try {
        Object.defineProperty(target, property, {
          value: source[property],
          configurable: true,
          enumerable: true,
        });
      } catch {
        // Some fetch implementations may make these properties non-configurable.
      }
    }
  }

  private wrapBodyWithTeardown(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let teardownPromise: Promise<void> | undefined;
    let streamCanceled = false;

    const runOnce = async (): Promise<void> => {
      teardownPromise ??= this.runTeardownCallbacks();
      await teardownPromise;
    };

    const source: UnderlyingByteSource = {
      type: "bytes",
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (streamCanceled) return;

          if (chunk.done) {
            await runOnce();
            if (streamCanceled) return;
            controller.close();
            return;
          }

          if (chunk.value.byteLength > 0) {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          await runOnce();
          if (streamCanceled) return;
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        streamCanceled = true;
        let cancelError: unknown;
        const cancelPromise = Promise.resolve()
          .then(() => reader.cancel(reason))
          .catch((error: unknown) => {
            cancelError = error;
          });

        await Promise.all([runOnce(), cancelPromise]);

        if (cancelError) throw cancelError;
      },
    };

    return new ReadableStream(source) as ReadableStream<Uint8Array>;
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

  private requireMiddleware(middleware: MiddlewareHandler): void {
    if (typeof middleware !== "function") {
      throw new TypeError("Middleware must be a function");
    }
  }
}
