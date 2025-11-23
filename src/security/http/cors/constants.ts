/**
 * CORS Constants
 * Default values and constants for CORS handling
 *
 * @module core/cors/constants
 */

import { DEV_LOCALHOST_ORIGINS } from "@veryfront/config";

/**
 * Default allowed HTTP methods for CORS
 */
export const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Default allowed headers for CORS
 */
export const DEFAULT_HEADERS = ["Content-Type", "Authorization"];

/**
 * Default max age for preflight cache (24 hours in seconds)
 */
export const DEFAULT_MAX_AGE = 86400;

/**
 * Development-only localhost origins
 * Re-exported from config/network-defaults for convenience
 *
 * Security Note: These are ONLY used in development mode.
 * Production mode requires explicit origin configuration.
 */
export { DEV_LOCALHOST_ORIGINS };

/**
 * HTTP status codes
 */
export const HTTP_NO_CONTENT = 204;
export const HTTP_FORBIDDEN = 403;

/**
 * Check if running in production mode
 * Checks multiple environment variables for robustness
 *
 * @returns true if in production, false if in development
 *
 * Security Note: Defaults to production (true) for fail-secure behavior.
 */
export function isProductionMode(): boolean {
  // Check Deno environment
  if (typeof Deno !== "undefined" && Deno.env) {
    const veryfrontEnv = Deno.env.get("VERYFRONT_ENV");
    const nodeEnv = Deno.env.get("NODE_ENV");
    const denoEnv = Deno.env.get("DENO_ENV");

    return (
      veryfrontEnv === "production" ||
      nodeEnv === "production" ||
      denoEnv === "production"
    );
  }

  // Check Node.js environment
  const globalProcess = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  if (globalProcess?.env) {
    const nodeEnv = globalProcess.env.NODE_ENV;
    const veryfrontEnv = globalProcess.env.VERYFRONT_ENV;

    return nodeEnv === "production" || veryfrontEnv === "production";
  }

  // Default to production for safety (fail-secure)
  return true;
}
