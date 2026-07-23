/**
 * Isolation Module
 *
 * Handles project isolation checks to prevent noisy neighbor issues.
 * Manages circuit breakers and concurrency limits per project.
 *
 * @module server/runtime-handler/isolation
 */

import { type IsolationCheckResult, projectIsolation } from "./project-isolation.ts";

// Re-export the type from project-isolation
export type { IsolationCheckResult } from "./project-isolation.ts";

/**
 * Injection interface for testing isolation dependencies
 */
interface IsolationDeps {
  checkRequest?: typeof projectIsolation.checkRequest;
  startRequest?: typeof projectIsolation.startRequest;
  completeRequest?: typeof projectIsolation.completeRequest;
  recordTimeout?: typeof projectIsolation.recordTimeout;
}

let injectedDeps: IsolationDeps | null = null;

/**
 * Inject dependencies for testing. Pass null to reset to defaults.
 */
export function __injectDepsForTests(deps: IsolationDeps | null): void {
  injectedDeps = deps;
}

function getDeps() {
  return {
    checkRequest: injectedDeps?.checkRequest ??
      projectIsolation.checkRequest.bind(projectIsolation),
    startRequest: injectedDeps?.startRequest ??
      projectIsolation.startRequest.bind(projectIsolation),
    completeRequest: injectedDeps?.completeRequest ??
      projectIsolation.completeRequest.bind(projectIsolation),
    recordTimeout: injectedDeps?.recordTimeout ??
      projectIsolation.recordTimeout.bind(projectIsolation),
  };
}

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

  const deps = getDeps();
  return deps.checkRequest(projectSlug);
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
    const deps = getDeps();
    deps.startRequest(projectSlug);
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
    const deps = getDeps();
    deps.completeRequest(projectSlug, isTimeout);
  }
}

/**
 * Record timeout state immediately, then release concurrency when work settles.
 *
 * A handler may ignore cancellation forever. Waiting for settlement before
 * recording the timeout would prevent the circuit breaker from seeing the
 * failure, while releasing the slot immediately would undercount live work.
 */
export function completeIsolatedRequestOnSettlement(
  projectSlug: string | undefined,
  shouldCheck: boolean,
  isTimeout: boolean,
  settled: Promise<void>,
): void {
  if (!shouldCheck) return;

  const deps = getDeps();
  if (isTimeout) deps.recordTimeout(projectSlug);

  const release = () => deps.completeRequest(projectSlug, false);
  void settled.then(release, release);
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
    : check.reason === "capacity"
    ? "Service temporarily unavailable. Please retry."
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
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
        ...(check.waitTimeMs ? { "Retry-After": String(Math.ceil(check.waitTimeMs / 1000)) } : {}),
      },
    },
  );
}

// Re-export for direct access if needed
export { projectIsolation } from "./project-isolation.ts";
