/**
 * CORS header handler
 *
 * @module security/middleware/cors-handler
 */

import type { SecurityConfig } from "./types.ts";
import { validateOriginSync } from "../cors/validators.ts";

/**
 * Set CORS headers on response
 *
 * Uses consolidated origin validation to determine allowed origin.
 * Reflects request origin if configured, or uses configured value.
 * Always sets Vary: Origin header for proper caching.
 *
 * @param headers - Response headers object to modify
 * @param req - Incoming request
 * @param securityConfig - Security configuration from project
 *
 * @example
 * ```ts
 * const headers = new Headers()
 * setCors(headers, request, securityConfig)
 * // headers now include Access-Control-Allow-Origin and Vary
 * ```
 */
export function setCors(headers: Headers, req: Request, securityConfig: SecurityConfig | null) {
  const conf = securityConfig?.cors;

  // Use consolidated validator for origin determination
  const validation = validateOriginSync(req.headers.get("origin"), conf);

  // Set the allowed origin if validation succeeded
  if (validation.allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);
  }

  // Always add Vary header for proper caching when origin is not wildcard
  if (validation.allowedOrigin && validation.allowedOrigin !== "*") {
    headers.set("Vary", "Origin");
  }
}
