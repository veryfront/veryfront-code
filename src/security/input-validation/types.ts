import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_MAX_HEADER_SIZE_BYTES,
  DEFAULT_MAX_URL_LENGTH_BYTES,
} from "#veryfront/utils/constants/index.ts";

export interface RequestLimits {
  maxBodySize?: number;
  maxUrlLength?: number;
  maxHeaderSize?: number;
  maxFileSize?: number;
}

/**
 * Framework-owned request limits.
 *
 * Freeze the public value so importing code cannot silently weaken the
 * process-wide defaults for later requests.
 */
export const DEFAULT_LIMITS: Readonly<Required<RequestLimits>> = Object.freeze({
  maxBodySize: DEFAULT_MAX_BODY_SIZE_BYTES,
  maxUrlLength: DEFAULT_MAX_URL_LENGTH_BYTES,
  maxHeaderSize: DEFAULT_MAX_HEADER_SIZE_BYTES,
  maxFileSize: DEFAULT_MAX_FILE_SIZE_BYTES,
});

export interface ParseJsonOptions {
  limits?: RequestLimits;
}

export interface ParseFormOptions {
  limits?: RequestLimits;
}

export interface ParseQueryOptions {
  limits?: RequestLimits;
}

export interface ValidatedData<TBody = unknown, TQuery = unknown> {
  body?: TBody;
  query?: TQuery;
}
