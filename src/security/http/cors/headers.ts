/**
 * CORS Headers
 * Functions for applying CORS headers to responses
 *
 * @module core/cors/headers
 */

import type { CORSConfig, CORSHeaderOptions, CORSValidationResult } from "./types.ts";
import { validateOrigin, validateOriginSync } from "./validators.ts";

/**
 * Apply CORS headers based on validation result.
 * Shared logic for both sync and async paths.
 */
function applyValidatedHeaders(
  validation: CORSValidationResult,
  options: CORSHeaderOptions,
): Response | void {
  const { response, headers: headersObj, config } = options;

  if (!validation.allowedOrigin) {
    return response;
  }

  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());

  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }

  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }

  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return;
}

/**
 * Apply CORS headers to a response or headers object
 * Adds appropriate CORS headers based on configuration
 *
 * @param options - Header application options
 * @returns New Response with CORS headers or modified Headers object
 */
export async function applyCORSHeaders(options: CORSHeaderOptions): Promise<Response | void> {
  const validation = await validateOrigin(options.request.headers.get("origin"), options.config);
  return applyValidatedHeaders(validation, options);
}

/**
 * Synchronous variant of applyCORSHeaders for contexts that require
 * immediate execution (e.g., fluent builder chains). Async origin validators
 * are not supported and will be ignored.
 */
export function applyCORSHeadersSync(options: CORSHeaderOptions): Response | void {
  const validation = validateOriginSync(options.request.headers.get("origin"), options.config);
  return applyValidatedHeaders(validation, options);
}

/**
 * Determine if CORS headers should be applied
 * Quick check without full validation
 *
 * @param request - The incoming request
 * @param config - CORS configuration
 * @returns True if CORS headers should be added
 */
export function shouldApplyCORS(request: Request, config?: boolean | CORSConfig): boolean {
  // No config = no CORS
  if (!config) {
    return false;
  }

  // Boolean true = always apply
  if (config === true) {
    return true;
  }

  // Check if origin header is present
  const origin = request.headers.get("origin");
  if (!origin) {
    // No origin header - only apply for wildcard
    return config.origin === "*";
  }

  // Has origin and config - will validate in applyCORSHeaders
  return true;
}
