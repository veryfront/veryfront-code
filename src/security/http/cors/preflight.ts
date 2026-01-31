import type { CORSPreflightOptions } from "./types.ts";
import { validateOrigin } from "./validators.ts";
import {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
} from "./constants.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function handleCORSPreflight(options: CORSPreflightOptions): Promise<Response> {
  return withSpan(
    "security.cors.preflight",
    async () => {
      const { request, config, allowMethods, allowHeaders } = options;

      const origin = request.headers.get("origin");
      const validation = await validateOrigin(origin, config);

      if (!validation.allowedOrigin) {
        if (!config) {
          return new Response(null, { status: HTTP_NO_CONTENT });
        }

        serverLogger.warn("[CORS] Preflight rejected", {
          origin,
          error: validation.error,
        });

        const errorMessage = validation.error ?? "CORS policy: Origin not allowed";

        return new Response(errorMessage, {
          status: HTTP_FORBIDDEN,
          headers: {
            "X-CORS-Error": validation.error ?? "Origin not allowed",
          },
        });
      }

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

      if (validation.allowedOrigin !== "*") {
        headers.set("Vary", "Origin");
      }

      const corsConfig = typeof config === "object" ? config : null;

      const methods = allowMethods ??
        (corsConfig?.methods?.length ? corsConfig.methods.join(", ") : DEFAULT_METHODS.join(", "));
      headers.set("Access-Control-Allow-Methods", methods);

      const requestedHeaders = request.headers.get("access-control-request-headers");
      const resolvedAllowedHeaders = allowHeaders ??
        requestedHeaders ??
        (corsConfig?.allowedHeaders?.length
          ? corsConfig.allowedHeaders.join(", ")
          : DEFAULT_HEADERS.join(", "));
      headers.set("Access-Control-Allow-Headers", resolvedAllowedHeaders);

      headers.set("Access-Control-Max-Age", String(corsConfig?.maxAge ?? DEFAULT_MAX_AGE));

      if (validation.allowCredentials && validation.allowedOrigin !== "*") {
        headers.set("Access-Control-Allow-Credentials", "true");
      }

      return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers,
      });
    },
    { "cors.origin": options.request.headers.get("origin") ?? "unknown" },
  );
}

export function isPreflightRequest(request: Request): boolean {
  return (
    request.method === "OPTIONS" &&
    (request.headers.has("access-control-request-method") ||
      request.headers.has("access-control-request-headers"))
  );
}
