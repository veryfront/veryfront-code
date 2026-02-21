export const MAX_PATH_TRAVERSAL_DEPTH = 10;
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
export const MAX_PATH_LENGTH = 4096;
export const DEFAULT_MAX_STRING_LENGTH = 1000;
