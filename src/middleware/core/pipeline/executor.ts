import type { ExecutionContext, MiddlewareHandler } from "../types.ts";
import { MiddlewareContext } from "../context.ts";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "#veryfront/utils";
// Direct import from base.ts to avoid circular dependency through barrel
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ensureError, getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

const NOT_FOUND_RESPONSE = (): Response => new Response("Not Found", { status: HTTP_NOT_FOUND });

export async function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<Response> {
  const context = new MiddlewareContext(req, env ?? {}, executionCtx);

  try {
    const response = await composedMiddleware(context, () => Promise.resolve(NOT_FOUND_RESPONSE()));
    return response ?? NOT_FOUND_RESPONSE();
  } catch (error) {
    const err = ensureError(error);
    serverLogger.error("Middleware pipeline error:", {
      url: req.url,
      method: req.method,
      error: getErrorMessage(error),
      stack: err.stack,
    });

    const nodeEnv = adapter?.env.get("NODE_ENV") ?? "production";

    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        method: req.method,
        url: req.url,
        ...(nodeEnv === "development" && {
          message: err.message,
          stack: err.stack?.split("\n").slice(0, 10),
        }),
      }),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
