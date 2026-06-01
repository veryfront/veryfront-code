/**
 * Shared HTTP response helpers for dev handlers.
 *
 * Used by the dev dashboard and projects API handlers to build consistent
 * JSON responses with no-cache headers.
 *
 * @module server/handlers/dev/http-helpers
 */

export const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-cache",
};

/** Build a pretty-printed JSON `Response` with no-cache headers. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

/** Build a JSON error `Response` of shape `{ error: message }`. */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}
