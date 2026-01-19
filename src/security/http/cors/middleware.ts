/**
 * CORS Middleware
 * Middleware implementation for CORS handling
 *
 * @module core/cors/middleware
 */

import type { Context, MiddlewareHandler } from "#veryfront/middleware/core/index.ts";
import type { CORSConfig } from "./types.ts";
import { handleCORSPreflight, isPreflightRequest } from "./preflight.ts";
import { applyCORSHeaders } from "./headers.ts";
import { validateCORSConfig } from "./validators.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

/**
 * Create CORS middleware
 * Full-featured CORS middleware with security validations
 *
 * @param config - CORS configuration
 * @returns Middleware handler function
 *
 * @example
 * ```typescript
 * // Allow specific origins
 * app.use('*', cors({
 *   origin: ['https://example.com', 'https://app.example.com'],
 *   credentials: true
 * }))
 *
 * // Dynamic origin validation
 * app.use('*', cors({
 *   origin: (origin) => origin.endsWith('.example.com'),
 *   methods: ['GET', 'POST'],
 *   maxAge: 3600
 * }))
 *
 * // Simple wildcard (not recommended for production)
 * app.use('*', cors({ origin: '*' }))
 * ```
 */
export function cors(config?: boolean | CORSConfig): MiddlewareHandler {
  // Validate configuration at middleware creation time
  const validation = validateCORSConfig(config);
  if (!validation.valid) {
    throw toError(createError({
      type: "config",
      message: `[CORS] Invalid configuration: ${validation.error}`,
    }));
  }

  return async (c: Context, next: () => Promise<Response | undefined> | Response) => {
    const request = c.req;

    // Handle preflight OPTIONS request
    if (isPreflightRequest(request)) {
      const response = await handleCORSPreflight({
        request,
        config,
      });

      // Set response on context
      return response;
    }

    // For actual requests, continue to next middleware
    const response = await next();

    // Add CORS headers to response
    if (response) {
      const corsResponse = await applyCORSHeaders({
        request,
        response,
        config,
      });

      return corsResponse || response;
    }

    return response;
  };
}

/**
 * Simple CORS middleware for basic use cases
 * Provides minimal CORS support without advanced features
 *
 * @param origin - Origin string or wildcard
 * @returns Middleware handler function
 *
 * @example
 * ```typescript
 * // Allow all origins (development only)
 * app.use('*', corsSimple('*'))
 *
 * // Allow specific origin
 * app.use('*', corsSimple('https://example.com'))
 * ```
 */
export function corsSimple(origin: string = "*"): MiddlewareHandler {
  return cors({
    origin,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
}
