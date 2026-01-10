import type { ExecutionContext, MiddlewareHandler, Next } from "../types.ts";
import { MiddlewareContext } from "../context.ts";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import { ensureError, getErrorMessage } from "../../../core/errors/veryfront-error.ts";

export async function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<Response> {
  const context = new MiddlewareContext(req, env || {}, executionCtx);

  let response: Response | undefined;

  try {
    const defaultNext: Next = () =>
      Promise.resolve(new Response("Not Found", { status: HTTP_NOT_FOUND }));

    response = await composedMiddleware(context, () => {
      return defaultNext();
    });
  } catch (error) {
    const { serverLogger } = await import("../../../core/utils/logger/logger.ts");
    const err = ensureError(error);
    serverLogger.error("Middleware pipeline error:", {
      url: req.url,
      method: req.method,
      error: getErrorMessage(error),
      stack: err.stack,
    });

    const nodeEnv = adapter?.env.get("NODE_ENV") || "production";

    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        method: req.method,
        url: req.url,
        ...(nodeEnv === "development" && {
          message: err.message,
          stack: err.stack?.split("\n").slice(0, 10), // Limit stack trace length
        }),
      }),
      {
        status: HTTP_SERVER_ERROR,
        headers: { "content-type": "application/json" },
      },
    );
  }

  return response || new Response("Not Found", { status: HTTP_NOT_FOUND });
}
