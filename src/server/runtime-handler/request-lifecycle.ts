/**
 * Request Lifecycle Module
 *
 * Manages request tracking, performance timing, and metrics.
 * Handles the start/end lifecycle of request processing.
 *
 * @module server/runtime-handler/request-lifecycle
 */

import {
  endRequest,
  isEnabled as isPerfEnabled,
  startRequest,
  startTimer,
  timeAsync,
} from "#veryfront/utils";
import { metrics } from "#veryfront/observability";
import type { RequestProfileRecord } from "#veryfront/observability";
import {
  endRequestMetrics,
  startRequestMetrics,
} from "#veryfront/platform/adapters/fs/veryfront/read-operations.ts";
import { requestTracker } from "./request-tracker.ts";
import { generateRequestId } from "#veryfront/utils/request-id.ts";
import {
  completeOnResponseBodySettlement,
  isEventStreamResponse,
} from "#veryfront/platform/compat/http/response-lifecycle.ts";

interface RequestLifecycleContext {
  /** Request ID for tracking */
  requestId: string;
  /** Performance request ID (only set if perf tracking enabled) */
  perfRequestId: string | undefined;
  /** Stop timer function for total request time */
  stopTotal: () => void;
  /** Whether this request should check isolation */
  shouldCheckIsolation: boolean;
}

/**
 * Start request lifecycle tracking.
 * Returns context needed to properly end the lifecycle.
 */
export function startRequestLifecycle(
  req: Request,
  _pathname: string,
  isLightweight: boolean,
): RequestLifecycleContext {
  const incomingId = req.headers.get("x-request-id");
  const perfEnabled = isPerfEnabled();
  const perfRequestId = perfEnabled ? generateRequestId(incomingId) : undefined;

  if (perfRequestId) startRequest(perfRequestId);
  const stopTotal = startTimer("total");

  const requestId = generateRequestId(incomingId);
  const shouldCheckIsolation = !isLightweight;

  return {
    requestId,
    perfRequestId,
    stopTotal,
    shouldCheckIsolation,
  };
}

/**
 * Start tracking a request in the request tracker.
 */
export function startRequestTracking(
  requestId: string,
  projectSlug: string | undefined,
  pathname: string,
  method: string,
  environment: string | undefined,
  releaseId: string | undefined,
): void {
  requestTracker.start(
    requestId,
    projectSlug,
    pathname,
    method,
    environment,
    releaseId,
  );
}

/**
 * Start per-request content metrics tracking.
 */
export function startContentMetrics(): void {
  startRequestMetrics();
}

/**
 * End per-request content metrics tracking.
 */
export function endContentMetrics(info: {
  requestId: string;
  pathname: string;
  mode: string;
}): void {
  endRequestMetrics(info);
}

/**
 * Complete request tracking and record completion status.
 */
export function completeRequestTracking(
  requestId: string,
  status: number,
  isTimeout: boolean,
  profile?: RequestProfileRecord | null,
): void {
  requestTracker.complete(requestId, status, isTimeout, profile);
}

/**
 * Keep streaming responses in the shutdown drain set until their body settles.
 * Handler completion only means response headers are ready; an SSE body may
 * continue producing events for several minutes after that point.
 */
export function completeRequestTrackingOnResponseEnd(
  requestId: string,
  response: Response,
  isTimeout: boolean,
  profile?: RequestProfileRecord | null,
): Response {
  if (!isEventStreamResponse(response)) {
    completeRequestTracking(requestId, response.status, isTimeout, profile);
    return response;
  }

  requestTracker.markLongLived(requestId);
  return completeOnResponseBodySettlement(response, () => {
    completeRequestTracking(requestId, response.status, isTimeout, profile);
  });
}

/**
 * End request lifecycle tracking.
 */
export function endRequestLifecycle(ctx: RequestLifecycleContext): void {
  ctx.stopTotal();
  if (ctx.perfRequestId) endRequest(ctx.perfRequestId);
}

/**
 * Increment the request metrics counter.
 */
export async function incrementRequestMetrics(): Promise<void> {
  await timeAsync("metrics:inc-request", () => metrics.incRequest());
}

// Re-export timeAsync for handler use
export { timeAsync };
