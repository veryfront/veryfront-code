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
    let handlerThrew = false;
    const composedMiddleware = this.compose();
    const monitoredMiddleware: MiddlewareHandler = async (context, next) => {
      try {
        return await composedMiddleware(context, next);
      } catch (error) {
        middlewareThrew = true;
        throw error;
      }
    };
    const monitoredHandler = (request: Request): Promise<Response> => {
      try {
        return Promise.resolve(handler(request)).catch((error: unknown) => {
          handlerThrew = true;
          throw error;
        });
      } catch (error) {
        handlerThrew = true;
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
        monitoredHandler,
      );
    } catch (error) {
      await this.runTeardownCallbacks();
      throw error;
    }

    return await this.withResponseTeardown(response, {
      immediate: middlewareThrew || handlerThrew,
    });
  }

  /**
   * Run every registered teardown callback once, in registration order,
   * without discarding them, so a module-scoped route pipeline fires them
   * again on the next request. Called by {@link execute} and {@link handle}:
   * after response bodies close, are canceled, or error; immediately for
   * bodyless, locked, or already-read responses and handler/middleware
   * exceptions. Callback errors are logged and swallowed so cleanup failures
   * never surface to the client.
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

  private async withResponseTeardown(
    response: Response,
    options: { immediate: boolean },
  ): Promise<Response> {
    const body = response.body;

    if (options.immediate || body === null || body.locked || response.bodyUsed) {
      await this.runTeardownCallbacks();
      return response;
    }

    const wrappedBody = this.wrapBodyWithTeardown(body);
    return new Response(wrappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private wrapBodyWithTeardown(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let teardownPromise: Promise<void> | undefined;
    let streamCanceled = false;

    const runOnce = async (): Promise<void> => {
      teardownPromise ??= this.runTeardownCallbacks();
      await teardownPromise;
    };

    return new ReadableStream<Uint8Array>({
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

          controller.enqueue(chunk.value);
        } catch (error) {
          await runOnce();
          if (streamCanceled) return;
          controller.error(error);
        }
      },
      cancel: async (reason) => {
        streamCanceled = true;
        let cancelError: unknown;

        try {
          await reader.cancel(reason);
        } catch (error) {
          cancelError = error;
        }

        await runOnce();

        if (cancelError) throw cancelError;
      },
    });
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
