/**
 * Input Validation Types
 * Type definitions for input validation system
 */

import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_HEADER_SIZE_BYTES,
  DEFAULT_MAX_URL_LENGTH_BYTES,
} from "@veryfront/utils/constants/index.ts";

/**
 * Request size limits configuration
 */
export interface RequestLimits {
  maxBodySize?: number;
  maxUrlLength?: number;
  maxHeaderSize?: number;
  maxFileSize?: number;
}

/**
 * Default size limits (conservative for security)
 */
export const DEFAULT_LIMITS: Required<RequestLimits> = {
  maxBodySize: DEFAULT_MAX_BODY_SIZE_BYTES, // 1MB
  maxUrlLength: DEFAULT_MAX_URL_LENGTH_BYTES, // 2KB
  maxHeaderSize: DEFAULT_MAX_HEADER_SIZE_BYTES, // 8KB
  maxFileSize: DEFAULT_MAX_FILE_SIZE_BYTES, // 5MB
};

/**
 * Validation options for JSON body parsing
 */
export interface ParseJsonOptions {
  limits?: RequestLimits;
  sanitize?: boolean;
}

/**
 * Validation options for form data parsing
 */
export interface ParseFormOptions {
  limits?: RequestLimits;
}

/**
 * Validated data container
 */
export interface ValidatedData<TBody = unknown, TQuery = unknown> {
  body?: TBody;
  query?: TQuery;
}
