/**
 * Handler priority constants
 *
 * These constants define the execution order of handlers in the middleware pipeline.
 * Lower numbers run first, higher numbers run last.
 *
 * Priority Levels:
 * - CRITICAL (0): Security, authentication - must run first
 * - VERY_HIGH (50): CORS, security headers - run very early
 * - HIGH (100-300): Health checks, monitoring, dev tools
 * - MEDIUM (400-700): File serving, API routes, RSC endpoints
 * - LOW (1000): SSR - catch-all for pages
 * - FALLBACK (10000): 404 handler - absolute last resort
 */

/** CRITICAL priority - Security and authentication handlers (runs first) */
export const PRIORITY_CRITICAL = 0;

/** VERY_HIGH priority - CORS and security headers */
export const PRIORITY_VERY_HIGH = 50;

/** HIGH priority - Health checks and monitoring endpoints */
export const PRIORITY_HIGH = 100;

/** HIGH priority - Client-side logging (dev mode) */
export const PRIORITY_HIGH_CLIENT_LOG = 200;

/** HIGH priority - Dev endpoints (dev mode) */
export const PRIORITY_HIGH_DEV = 300;

/** MEDIUM priority - Dev file handler */
export const PRIORITY_MEDIUM_DEV_FILES = 400;

/** MEDIUM priority - Static file serving */
export const PRIORITY_MEDIUM_STATIC = 500;

/** MEDIUM priority - Self-hosted lib modules (veryfront/ai/*) */
export const PRIORITY_MEDIUM_LIB_MODULES = 550;

/** MEDIUM priority - RSC, module, and static handlers */
export const PRIORITY_MEDIUM = 600;

/** MEDIUM priority - API route handlers */
export const PRIORITY_MEDIUM_API = 700;

/** LOW priority - SSR handler (catch-all for pages) */
export const PRIORITY_LOW = 1000;

/** FALLBACK priority - 404 handler (runs last) */
export const PRIORITY_FALLBACK = 10000;

/**
 * Priority level definitions for better readability in code
 */
export const HANDLER_PRIORITIES = {
  CRITICAL: PRIORITY_CRITICAL,
  VERY_HIGH: PRIORITY_VERY_HIGH,
  HIGH: PRIORITY_HIGH,
  HIGH_CLIENT_LOG: PRIORITY_HIGH_CLIENT_LOG,
  HIGH_DEV: PRIORITY_HIGH_DEV,
  MEDIUM_DEV_FILES: PRIORITY_MEDIUM_DEV_FILES,
  MEDIUM_STATIC: PRIORITY_MEDIUM_STATIC,
  MEDIUM_LIB_MODULES: PRIORITY_MEDIUM_LIB_MODULES,
  MEDIUM: PRIORITY_MEDIUM,
  MEDIUM_API: PRIORITY_MEDIUM_API,
  LOW: PRIORITY_LOW,
  FALLBACK: PRIORITY_FALLBACK,
} as const;
