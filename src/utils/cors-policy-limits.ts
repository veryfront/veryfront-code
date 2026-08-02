/**
 * Shared resource limits for CORS configuration and generated response headers.
 *
 * This module deliberately lives below both config and security so schema-time
 * and runtime validation use the same contract without introducing a cycle.
 */

export const MAX_CORS_ORIGIN_LENGTH = 2048;
export const MAX_CORS_ORIGIN_COUNT = 64;
export const MAX_CORS_ORIGIN_LIST_LENGTH = 8192;
export const MAX_CORS_TOKEN_LENGTH = 256;
export const MAX_CORS_TOKEN_COUNT = 64;
export const MAX_CORS_SERIALIZED_LIST_LENGTH = 4096;
export const MAX_CORS_MAX_AGE = Number.MAX_SAFE_INTEGER;

/** RFC 9110 token syntax shared by schema and runtime CORS validation. */
export const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CORS_POLICY_RESPONSE_HEADER_PREFIX = "access-control-";
// Origin values are header values; controls are never valid and would make
// Headers.set() throw instead of producing a deterministic CORS denial.
const LIST_SEPARATOR_LENGTH = 2;

function isHeaderSafeByteString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code > 0xff) return false;
  }
  return true;
}

function serializedListLength(values: readonly string[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value.length, 0) +
    (values.length - 1) * LIST_SEPARATOR_LENGTH;
}

export function isBoundedCorsOrigin(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CORS_ORIGIN_LENGTH &&
    value.trim() === value &&
    isHeaderSafeByteString(value);
}

export function isBoundedCorsOriginList(values: readonly unknown[]): values is readonly string[] {
  if (values.length === 0 || values.length > MAX_CORS_ORIGIN_COUNT) return false;
  if (!values.every(isBoundedCorsOrigin)) return false;
  return serializedListLength(values) <= MAX_CORS_ORIGIN_LIST_LENGTH;
}

export function isBoundedCorsToken(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CORS_TOKEN_LENGTH &&
    HTTP_TOKEN_PATTERN.test(value);
}

export function isBoundedCorsTokenList(values: readonly unknown[]): values is readonly string[] {
  if (values.length > MAX_CORS_TOKEN_COUNT) return false;
  if (!values.every(isBoundedCorsToken)) return false;
  return serializedListLength(values) <= MAX_CORS_SERIALIZED_LIST_LENGTH;
}

export function isValidCorsMaxAge(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_CORS_MAX_AGE;
}

/** Whether a response header is reserved for the dedicated CORS policy layer. */
export function isCorsPolicyResponseHeaderName(value: unknown): value is string {
  return typeof value === "string" &&
    value.slice(0, CORS_POLICY_RESPONSE_HEADER_PREFIX.length).toLowerCase() ===
      CORS_POLICY_RESPONSE_HEADER_PREFIX;
}
