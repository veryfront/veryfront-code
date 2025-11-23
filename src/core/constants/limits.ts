/**
 * Display limits and truncation constants
 *
 * These constants define how much data to show in logs, error messages,
 * debug output, and other user-facing displays to prevent overwhelming
 * output or memory issues.
 */

/** Maximum string length for general display purposes */
export const MAX_STRING_DISPLAY_LENGTH = 1000;

/** Maximum characters to show in log preview (e.g., request body) */
export const LOG_PREVIEW_MAX_LENGTH_CHARS = 500;

/** Maximum characters for short log preview (e.g., WebSocket data) */
export const LOG_PREVIEW_SHORT_LENGTH_CHARS = 100;

/** Maximum characters for code preview in error messages */
export const CODE_PREVIEW_MAX_LENGTH_CHARS = 200;

/** Maximum number of stack trace lines to show */
export const MAX_STACK_TRACE_LINES = 100;

/** Maximum characters in span/trace names before truncation */
export const MAX_SPAN_NAME_LENGTH = 1000;

/** Maximum size of attribute values in traces (10KB) */
export const MAX_TRACE_ATTRIBUTE_VALUE_SIZE = 10000;

/** Maximum number of events per span before truncation */
export const MAX_EVENTS_PER_SPAN = 100;

/** Maximum number of links per span before truncation */
export const MAX_LINKS_PER_SPAN = 100;

/** Maximum action arguments for RSC server actions */
export const MAX_SERVER_ACTION_ARGS = 50;

/** Maximum test iterations for performance tests */
export const MAX_TEST_ITERATIONS = 100;

/** Maximum cache entries for various caches */
export const CACHE_MAX_ENTRIES_SMALL = 50;
export const CACHE_MAX_ENTRIES_MEDIUM = 200;
export const CACHE_MAX_ENTRIES_LARGE = 500;
export const CACHE_MAX_ENTRIES_XLARGE = 1000;

/** API route matcher cache size */
export const API_ROUTE_CACHE_MAX_ENTRIES = 500;

/** Handler cache size */
export const HANDLER_CACHE_MAX_ENTRIES = 256;

/** Maximum path length for security validation */
export const MAX_PATH_LENGTH_CHARS = 4096;

/** Maximum port number (valid TCP port range) */
export const MAX_PORT_NUMBER = 65535;

/** Minimum port number (valid TCP port range) */
export const MIN_PORT_NUMBER = 1;

/** Maximum URL length for schema validation */
export const MAX_URL_LENGTH_FOR_VALIDATION = 2048;
