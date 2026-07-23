import type {
  ExecutionContext,
  MiddlewareExecutionAdapter,
  MiddlewareHandler,
  RuntimeMiddlewareHandler,
} from "../types.ts";
import { MiddlewareContext } from "../context.ts";
import { HTTP_NOT_FOUND, HTTP_SERVER_ERROR, serverLogger } from "#veryfront/utils";
import {
  isWebSocketUpgradeResponse,
  type RuntimeRequestHandler,
  type RuntimeResponse,
} from "#veryfront/platform/adapters/base.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";

const SAFE_HTTP_METHOD = /^[A-Z][A-Z0-9!#$%&'*+.^_`|~-]{0,31}$/;

export function getSafeRequestMethod(method: string): string {
  return SAFE_HTTP_METHOD.test(method) ? method : "UNKNOWN";
}

function notFoundResponse(): Response {
  return new Response("Not Found", { status: HTTP_NOT_FOUND });
}

function isNativeWebSocketUpgradeResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.status === 101 && candidate.body === null &&
    candidate.headers instanceof Headers &&
    typeof candidate.webSocket === "object" && candidate.webSocket !== null;
}

export function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  _adapter?: MiddlewareExecutionAdapter,
  finalHandler?: (req: Request) => Response | Promise<Response>,
): Promise<Response>;
export function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: RuntimeMiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  _adapter?: MiddlewareExecutionAdapter,
  finalHandler?: RuntimeRequestHandler,
): Promise<RuntimeResponse>;
export function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler | RuntimeMiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  _adapter?: MiddlewareExecutionAdapter,
  finalHandler?: RuntimeRequestHandler,
): Promise<RuntimeResponse> {
  return withSpan(
    "middleware.pipeline.execute",
    async (): Promise<RuntimeResponse> => {
      const context = new MiddlewareContext(req, env ?? {}, executionCtx);
      const method = getSafeRequestMethod(req.method);

      try {
        const next = finalHandler
          ? () => Promise.resolve(finalHandler(req))
          : () => Promise.resolve(notFoundResponse());

        const response = await (composedMiddleware as RuntimeMiddlewareHandler)(
          context,
          next,
        );

        if (response === undefined) return notFoundResponse();
        if (
          response instanceof Response || isWebSocketUpgradeResponse(response) ||
          isNativeWebSocketUpgradeResponse(response)
        ) {
          return response;
        }
        throw new TypeError(
          "Middleware must return a Response, a WebSocket upgrade response, or undefined",
        );
      } catch (error) {
        serverLogger.error("Middleware pipeline error", {
          errorCategory: classifyTelemetryError(error),
          method,
        });

        const body: Record<string, unknown> = {
          error: "Internal Server Error",
          method,
          url: "[REDACTED]",
        };
        const responseBody = method === "HEAD" ? null : JSON.stringify(body);
        return new Response(responseBody, {
          status: HTTP_SERVER_ERROR,
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json",
            "x-content-type-options": "nosniff",
          },
        });
      }
    },
    { "http.method": getSafeRequestMethod(req.method) },
  );
}
