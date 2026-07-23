import type { CORSPreflightOptions } from "./types.ts";
import { validateOrigin } from "./validators.ts";
import {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
} from "./constants.ts";
import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = serverLogger.component("cors");

function splitHeaderList(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function includesCaseInsensitive(values: readonly string[], candidate: string): boolean {
  const normalizedCandidate = candidate.toLowerCase();
  return values.some((value) => value.toLowerCase() === normalizedCandidate);
}

function forbiddenPreflight(reason: string): Response {
  logger.warn("Preflight rejected", { reason });
  return new Response("CORS preflight rejected", {
    status: HTTP_FORBIDDEN,
    headers: { "X-CORS-Error": reason },
  });
}

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

        return forbiddenPreflight(validation.error ?? "Origin not allowed");
      }

      const headers = new Headers();
      headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

      if (validation.allowedOrigin !== "*") {
        headers.set("Vary", "Origin");
      }

      const corsConfig = typeof config === "object" ? config : null;

      const methods = allowMethods
        ? splitHeaderList(allowMethods)
        : corsConfig?.methods?.length
        ? corsConfig.methods
        : DEFAULT_METHODS;
      const requestedMethod = request.headers.get("access-control-request-method")?.trim();
      if (!requestedMethod) return forbiddenPreflight("Request method is required");
      if (!includesCaseInsensitive(methods, requestedMethod)) {
        return forbiddenPreflight("Request method is not allowed");
      }
      headers.set("Access-Control-Allow-Methods", methods.join(", "));

      const requestedHeaders = request.headers.get("access-control-request-headers");
      const resolvedAllowedHeaders = allowHeaders
        ? splitHeaderList(allowHeaders)
        : corsConfig?.allowedHeaders?.length
        ? corsConfig.allowedHeaders
        : DEFAULT_HEADERS;
      if (
        requestedHeaders &&
        splitHeaderList(requestedHeaders).some((header) =>
          !includesCaseInsensitive(resolvedAllowedHeaders, header)
        )
      ) {
        return forbiddenPreflight("Request header is not allowed");
      }
      headers.set("Access-Control-Allow-Headers", resolvedAllowedHeaders.join(", "));

      headers.set("Access-Control-Max-Age", String(corsConfig?.maxAge ?? DEFAULT_MAX_AGE));

      if (validation.allowCredentials && validation.allowedOrigin !== "*") {
        headers.set("Access-Control-Allow-Credentials", "true");
      }

      return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers,
      });
    },
    {},
  );
}

export function isPreflightRequest(request: Request): boolean {
  return (
    request.method === "OPTIONS" &&
    (request.headers.has("access-control-request-method") ||
      request.headers.has("access-control-request-headers"))
  );
}
