
import type { CORSPreflightOptions } from "./types.ts";
import { validateOrigin } from "./validators.ts";
import {
  DEFAULT_HEADERS,
  DEFAULT_MAX_AGE,
  DEFAULT_METHODS,
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
} from "./constants.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";

export async function handleCORSPreflight(options: CORSPreflightOptions): Promise<Response> {
  const { request, config, allowMethods, allowHeaders } = options;

  const validation = await validateOrigin(request.headers.get("origin"), config);

  if (!validation.allowedOrigin) {
    if (!config) {
      return new Response(null, {
        status: HTTP_NO_CONTENT,
      });
    }

    serverLogger.warn("[CORS] Preflight rejected", {
      origin: request.headers.get("origin"),
      error: validation.error,
    });

    return new Response(validation.error || "CORS policy: Origin not allowed", {
      status: HTTP_FORBIDDEN,
      headers: {
        "X-CORS-Error": validation.error || "Origin not allowed",
      },
    });
  }

  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    headers.set("Vary", "Origin");
  }

  const corsConfig = typeof config === "object" ? config : null;
  const methods = allowMethods ||
    (corsConfig?.methods?.length ? corsConfig.methods.join(", ") : DEFAULT_METHODS.join(", "));
  headers.set("Access-Control-Allow-Methods", methods);

  let allowedHeaders = allowHeaders;
  if (!allowedHeaders) {
    const requestedHeaders = request.headers.get("access-control-request-headers");
    if (requestedHeaders) {
      allowedHeaders = requestedHeaders;
    } else if (corsConfig?.allowedHeaders?.length) {
      allowedHeaders = corsConfig.allowedHeaders.join(", ");
    } else {
      allowedHeaders = DEFAULT_HEADERS.join(", ");
    }
  }
  headers.set("Access-Control-Allow-Headers", allowedHeaders);

  const maxAge = corsConfig?.maxAge ?? DEFAULT_MAX_AGE;
  headers.set("Access-Control-Max-Age", String(maxAge));

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(null, {
    status: HTTP_NO_CONTENT,
    headers,
  });
}

export function isPreflightRequest(request: Request): boolean {
  return request.method === "OPTIONS" &&
    (request.headers.has("access-control-request-method") ||
      request.headers.has("access-control-request-headers"));
}
