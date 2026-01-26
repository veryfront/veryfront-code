import * as dntShim from "../../../../_dnt.shims.js";
import type { ExecutionContext, MiddlewareHandler } from "../types.js";
import { MiddlewareContext } from "../context.js";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from "../../../utils/index.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { ensureError, getErrorMessage } from "../../../errors/veryfront-error.js";
import { serverLogger } from "../../../utils/logger/logger.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";

function notFoundResponse(): dntShim.Response {
  return new dntShim.Response("Not Found", { status: HTTP_NOT_FOUND });
}

export function executeMiddlewarePipeline(
  req: dntShim.Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<dntShim.Response> {
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

        return new dntShim.Response(
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
