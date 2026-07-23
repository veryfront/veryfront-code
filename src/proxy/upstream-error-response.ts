import { jsonErrorResponse } from "./error-response.ts";

/** HTTP status returned when the upstream request exceeds its deadline. */
export const UPSTREAM_TIMEOUT_STATUS = 504;
/** HTTP status returned when the upstream server cannot complete the request. */
export const UPSTREAM_FAILURE_STATUS = 502;

/** Create the bounded public response for an upstream timeout. */
export function createUpstreamTimeoutResponse(timeoutMs: number): Response {
  return jsonErrorResponse(UPSTREAM_TIMEOUT_STATUS, {
    error: "Gateway Timeout",
    message: `Server request timed out after ${timeoutMs}ms`,
  });
}

/** Create a generic upstream failure response without exposing the underlying error. */
export function createUpstreamFailureResponse(_error: unknown): Response {
  // The real error is logged server-side by the caller (proxyLogger). Keep the
  // client-facing body generic so internal hostnames/paths carried in
  // error.message are not leaked to the client.
  return jsonErrorResponse(UPSTREAM_FAILURE_STATUS, {
    error: "Bad Gateway",
    message: "Bad Gateway",
  });
}
