import type { ExecutionContext, MiddlewareHandler } from "../types.ts";
import { MiddlewareContext } from "../context.ts";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { ensureError, getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

function notFoundResponse(): Response {
  return new Response("Not Found", { status: HTTP_NOT_FOUND });
}

export function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<Response> {
  return withSpan(
    "middleware.pipeline.execute",
    async () => {
      const context = new MiddlewareContext(req, env ?? {}, executionCtx);

      try {
        const response = await composedMiddleware(
          context,
          () => Promise.resolve(notFoundResponse()),
        );

        return response ?? notFoundResponse();
      } catch (error) {
        const normalizedError = ensureError(error);

        serverLogger.error("Middleware pipeline error:", {
          url: req.url,
          method: req.method,
          error: getErrorMessage(error),
          stack: normalizedError.stack,
        });

        const nodeEnv = adapter?.env.get("NODE_ENV") ?? "production";

        return new Response(
          JSON.stringify({
            error: "Internal Server Error",
            method: req.method,
            url: req.url,
            ...(nodeEnv === "development" && {
              message: normalizedError.message,
              stack: normalizedError.stack?.split("\n").slice(0, 10),
            }),
          }),
          {
            status: HTTP_SERVER_ERROR,
            headers: { "content-type": "application/json" },
          },
        );
      }
    },
    { "http.method": req.method, "http.url": req.url },
  );
}
