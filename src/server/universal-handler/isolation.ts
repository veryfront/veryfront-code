/**
 * Isolation Module
 *
 * Handles project isolation checks to prevent noisy neighbor issues.
 * Manages circuit breakers and concurrency limits per project.
 *
 * @module server/universal-handler/isolation
 */

import { type IsolationCheckResult, projectIsolation } from "./project-isolation.ts";

// Re-export the type from project-isolation
export type { IsolationCheckResult } from "./project-isolation.ts";

/**
 * Check if a request is allowed to proceed based on isolation rules.
 */
export function checkRequestIsolation(
  projectSlug: string | undefined,
  shouldCheck: boolean,
): IsolationCheckResult {
  if (!shouldCheck) {
    return { allowed: true };
  }

  return projectIsolation.checkRequest(projectSlug);
}

/**
 * Start tracking an isolated request.
 * Call this after checkRequestIsolation returns allowed: true.
 */
export function startIsolatedRequest(
  projectSlug: string | undefined,
  shouldCheck: boolean,
): void {
  if (shouldCheck) {
    projectIsolation.startRequest(projectSlug);
  }
}

/**
 * Complete an isolated request.
 * Updates circuit breaker state based on timeout status.
 */
export function completeIsolatedRequest(
  projectSlug: string | undefined,
  shouldCheck: boolean,
  isTimeout: boolean,
): void {
  if (shouldCheck) {
    projectIsolation.completeRequest(projectSlug, isTimeout);
  }
}

/**
 * Create a 503 Service Unavailable response for isolation rejection.
 */
export function createIsolationErrorResponse(
  check: IsolationCheckResult,
): Response {
  const message = check.reason === "circuit_open"
    ? `Service temporarily unavailable for project. Retry after ${
      Math.ceil((check.waitTimeMs ?? 0) / 1000)
    } seconds.`
    : check.reason === "max_concurrent"
    ? "Too many concurrent requests for this project. Please retry."
    : "Request rejected due to isolation policy.";

  return new Response(
    JSON.stringify({
      error: message,
      reason: check.reason,
      retryAfterMs: check.waitTimeMs,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        ...(check.waitTimeMs ? { "Retry-After": String(Math.ceil(check.waitTimeMs / 1000)) } : {}),
      },
    },
  );
}

// Re-export for direct access if needed
export { projectIsolation } from "./project-isolation.ts";
