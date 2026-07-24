import { jsonErrorResponse } from "./error-response.ts";

export const UPSTREAM_TIMEOUT_STATUS = 504;
export const UPSTREAM_FAILURE_STATUS = 502;

export function createUpstreamTimeoutResponse(timeoutMs: number): Response {
  return jsonErrorResponse(UPSTREAM_TIMEOUT_STATUS, {
    error: "Gateway Timeout",
    message: `Server request timed out after ${timeoutMs}ms`,
  });
}

export function createUpstreamFailureResponse(_error: unknown): Response {
  // The real error is logged server-side by the caller (proxyLogger). Keep the
  // client-facing body generic so internal hostnames/paths carried in
  // error.message are not leaked to the client.
  return jsonErrorResponse(UPSTREAM_FAILURE_STATUS, {
    error: "Bad Gateway",
    message: "Bad Gateway",
  });
}
