import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { HTTP_UNAVAILABLE } from "#veryfront/utils/constants/index.ts";

/** Stable error code returned when the renderer is in lame-duck shutdown mode. */
export const RUNTIME_SHUTTING_DOWN_CODE = "RUNTIME_SHUTTING_DOWN";

/** Human-readable message paired with {@link RUNTIME_SHUTTING_DOWN_CODE}. */
export const RUNTIME_SHUTTING_DOWN_MESSAGE =
  "Runtime is shutting down; retry against another instance";

/**
 * Builds the 503 response used to reject new agent-work requests while the
 * renderer is draining. Sends `Connection: close` so the API drops the keep-alive
 * connection to this terminating pod, and deliberately omits the runtime-owner
 * invoke URL header so the API does not re-pin the run to this pod's IP.
 */
export function buildRuntimeShuttingDownResponse(builder: ResponseBuilder): Response {
  return builder
    .withHeaders({ Connection: "close" })
    .json(
      { code: RUNTIME_SHUTTING_DOWN_CODE, message: RUNTIME_SHUTTING_DOWN_MESSAGE },
      HTTP_UNAVAILABLE,
    );
}
