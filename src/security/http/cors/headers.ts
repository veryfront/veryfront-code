/**
 * CORS Headers - apply CORS headers to responses
 */

import type { CORSConfig, CORSHeaderOptions, CORSValidationResult } from "./types.ts";
import { validateOrigin, validateOriginSync } from "./validators.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

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
}

/** Apply CORS headers to a response or headers object */
export function applyCORSHeaders(options: CORSHeaderOptions): Promise<Response | void> {
  return withSpan("security.cors.applyHeaders", async () => {
    const validation = await validateOrigin(options.request.headers.get("origin"), options.config);
    return applyValidatedHeaders(validation, options);
  }, { "cors.origin": options.request.headers.get("origin") ?? "unknown" });
}

/** Synchronous variant for immediate execution (e.g., fluent builder chains) */
export function applyCORSHeadersSync(options: CORSHeaderOptions): Response | void {
  const validation = validateOriginSync(options.request.headers.get("origin"), options.config);
  return applyValidatedHeaders(validation, options);
}

/** Quick check if CORS headers should be applied */
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
