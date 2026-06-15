import { jsonErrorResponse } from "./error-response.ts";

export const UPSTREAM_TIMEOUT_STATUS = 504;
export const UPSTREAM_FAILURE_STATUS = 502;

export function createUpstreamTimeoutResponse(timeoutMs: number): Response {
  return jsonErrorResponse(UPSTREAM_TIMEOUT_STATUS, {
    error: "Gateway Timeout",
    message: `Server request timed out after ${timeoutMs}ms`,
  });
}

export function createUpstreamFailureResponse(error: unknown): Response {
  return jsonErrorResponse(UPSTREAM_FAILURE_STATUS, {
    error: "Proxy Error",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
