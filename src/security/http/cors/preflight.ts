/**
 * CORS Preflight Handler
 * Handles OPTIONS preflight requests for CORS
 *
 * @module core/cors/preflight
 */

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

/**
 * Handle CORS preflight request
 * Returns appropriate response for OPTIONS requests
 *
 * @param options - Preflight handling options
 * @returns Response with CORS headers or error
 */
export async function handleCORSPreflight(options: CORSPreflightOptions): Promise<Response> {
  const { request, config, allowMethods, allowHeaders } = options;

  // Validate origin
  const validation = await validateOrigin(request.headers.get("origin"), config);

  // If origin not allowed but no config provided, return success without CORS headers (secure-by-default)
  // This allows OPTIONS requests to succeed but doesn't expose CORS capabilities
  if (!validation.allowedOrigin) {
    // No config = allow OPTIONS but no CORS headers (secure-by-default)
    if (!config) {
      return new Response(null, {
        status: HTTP_NO_CONTENT,
      });
    }

    // Config exists but origin not allowed = reject
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

  // Build preflight response headers
  const headers = new Headers();

  // Set allowed origin
  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  // Add Vary header for non-wildcard origins
  if (validation.allowedOrigin !== "*") {
    headers.set("Vary", "Origin");
  }

  // Determine allowed methods
  const corsConfig = typeof config === "object" ? config : null;
  const methods = allowMethods ||
    (corsConfig?.methods?.length ? corsConfig.methods.join(", ") : DEFAULT_METHODS.join(", "));
  headers.set("Access-Control-Allow-Methods", methods);

  // Determine allowed headers
  let allowedHeaders = allowHeaders;
  if (!allowedHeaders) {
    // Check if specific headers were requested
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

  // Set max age for preflight caching
  const maxAge = corsConfig?.maxAge ?? DEFAULT_MAX_AGE;
  headers.set("Access-Control-Max-Age", String(maxAge));

  // Add credentials if configured and allowed
  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return new Response(null, {
    status: HTTP_NO_CONTENT,
    headers,
  });
}

/**
 * Check if request is a CORS preflight request
 *
 * @param request - The incoming request
 * @returns True if this is a preflight request
 */
export function isPreflightRequest(request: Request): boolean {
  return request.method === "OPTIONS" &&
    (request.headers.has("access-control-request-method") ||
      request.headers.has("access-control-request-headers"));
}
