/**
 * CORS Headers
 * Functions for applying CORS headers to responses
 *
 * @module core/cors/headers
 */

import type { CORSConfig, CORSHeaderOptions } from "./types.ts";
import { validateOrigin, validateOriginSync } from "./validators.ts";

/**
 * Apply CORS headers to a response or headers object
 * Adds appropriate CORS headers based on configuration
 *
 * @param options - Header application options
 * @returns New Response with CORS headers or modified Headers object
 */
export async function applyCORSHeaders(options: CORSHeaderOptions): Promise<Response | void> {
  const { request, response, headers: headersObj, config } = options;

  // Validate origin
  const validation = await validateOrigin(request.headers.get("origin"), config);

  // No CORS headers if origin not allowed
  if (!validation.allowedOrigin) {
    return response;
  }

  // Determine which headers object to modify
  const headers = headersObj || (response ? new Headers(response.headers) : new Headers());

  // Set allowed origin
  headers.set("Access-Control-Allow-Origin", validation.allowedOrigin);

  // Add Vary header for non-wildcard origins
  if (validation.allowedOrigin !== "*") {
    const existingVary = headers.get("Vary");
    const varyValues = existingVary ? existingVary.split(",").map((v) => v.trim()) : [];
    if (!varyValues.includes("Origin")) {
      varyValues.push("Origin");
      headers.set("Vary", varyValues.join(", "));
    }
  }

  // Add credentials if allowed
  if (validation.allowCredentials && validation.allowedOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  // Add exposed headers if configured
  const corsConfig = typeof config === "object" ? config : null;
  if (corsConfig?.exposedHeaders && corsConfig.exposedHeaders.length > 0) {
    headers.set("Access-Control-Expose-Headers", corsConfig.exposedHeaders.join(", "));
  }

  // If modifying an existing response, return new response with updated headers
  if (response) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // If only modifying headers object, changes are made in place
  return;
}

/**
 * Synchronous variant of applyCORSHeaders for contexts that require
 * immediate execution (e.g., fluent builder chains). Async origin validators
 * are not supported and will be ignored.
 */
export function applyCORSHeadersSync(options: CORSHeaderOptions): Response | void {
  const { request, response, headers: headersObj, config } = options;
  const validation = validateOriginSync(request.headers.get("origin"), config);

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
