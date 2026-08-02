export const DEFAULT_METHODS: readonly string[] = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
export const DEFAULT_HEADERS: readonly string[] = Object.freeze([
  "Content-Type",
  "Authorization",
]);

export function getDefaultCORSMethods(): readonly string[] {
  return DEFAULT_METHODS;
}

export function getDefaultCORSHeaders(): readonly string[] {
  return DEFAULT_HEADERS;
}

export const DEFAULT_MAX_AGE = 86400;

export const HTTP_NO_CONTENT = 204;
export const HTTP_FORBIDDEN = 403;
