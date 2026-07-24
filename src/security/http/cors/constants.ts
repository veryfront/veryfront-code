const CANONICAL_DEFAULT_METHODS: readonly string[] = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
const CANONICAL_DEFAULT_HEADERS: readonly string[] = Object.freeze([
  "Content-Type",
  "Authorization",
]);

// Keep the established mutable array contract of these public constants.
// Runtime policy code consumes the private canonical values below so consumer
// mutation cannot alter server behavior.
export const DEFAULT_METHODS: string[] = [...CANONICAL_DEFAULT_METHODS];
export const DEFAULT_HEADERS: string[] = [...CANONICAL_DEFAULT_HEADERS];

export function getDefaultCORSMethods(): readonly string[] {
  return CANONICAL_DEFAULT_METHODS;
}

export function getDefaultCORSHeaders(): readonly string[] {
  return CANONICAL_DEFAULT_HEADERS;
}

export const DEFAULT_MAX_AGE = 86400;

export const HTTP_NO_CONTENT = 204;
export const HTTP_FORBIDDEN = 403;
