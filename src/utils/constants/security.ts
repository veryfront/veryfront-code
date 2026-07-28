/** Maximum value for path traversal depth. */
export const MAX_PATH_TRAVERSAL_DEPTH = 10;
/** Shared forbidden path patterns value. */
export const FORBIDDEN_PATH_PATTERNS = [/\0/];

/**
 * Fast-match pattern for common vulnerability scanner probe paths.
 * Keep this scoped to root-level probe paths so valid nested application
 * routes are not accidentally blocked.
 */
export const SCANNER_PATH_PATTERN =
  /^\/(?:wp-(?:admin|login\.php|includes|content|config\.php)(?:\/|$)|cgi-bin(?:\/|$)|xmlrpc\.php$|\.git(?:\/|$)|\.env(?:\..*)?$)/i;
export const DIRECTORY_TRAVERSAL_PATTERN = /\.\.[\/\\]/;
export const ABSOLUTE_PATH_PATTERN = /^[\/\\]/;
/** Maximum value for path length. */
export const MAX_PATH_LENGTH = 4096;
/** Maximum length of one configured CSRF cookie or header name. */
export const MAX_CSRF_NAME_LENGTH = 256;
/** Maximum safe integer accepted for a CSRF cookie Max-Age value. */
export const MAX_CSRF_TTL_SECONDS = Number.MAX_SAFE_INTEGER;
export const DEFAULT_MAX_STRING_LENGTH = 1000;
