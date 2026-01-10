/**
 * CORS header handler
 */

import type { SecurityConfig } from "./types.ts";
import { validateOriginSync } from "../cors/validators.ts";

/** Set CORS headers on response using consolidated origin validation */
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
