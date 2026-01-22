/**
 * CORS Constants
 * Default values and constants for CORS handling
 *
 * @module core/cors/constants
 */

import { DEV_LOCALHOST_ORIGINS } from "#veryfront/config";

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
