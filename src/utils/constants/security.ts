export const MAX_PATH_TRAVERSAL_DEPTH = 10;
export const FORBIDDEN_PATH_PATTERNS = [/\0/];

/**
 * Fast-match pattern for common vulnerability scanner probe paths.
 * These paths are never valid Veryfront routes and can be rejected
 * before entering the rendering pipeline.
 */
export const SCANNER_PATH_PATTERN =
  /\.(?:php|asp|aspx|jsp|cgi|env)$|\/(?:wp-(?:admin|login|includes|content)|\.git|cgi-bin)\//i;
export const DIRECTORY_TRAVERSAL_PATTERN = /\.\.[\/\\]/;
export const ABSOLUTE_PATH_PATTERN = /^[\/\\]/;
export const MAX_PATH_LENGTH = 4096;
export const DEFAULT_MAX_STRING_LENGTH = 1000;
