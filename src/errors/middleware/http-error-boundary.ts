/**
 * HTTP Error Boundary Middleware
 *
 * Unified error catch → serialize → respond pipeline for HTTP boundaries.
 * Implements RFC 9457 (Problem Details for HTTP APIs) compliant error responses.
 *
 * @module errors/middleware/http-error-boundary
 * @see https://datatracker.ietf.org/doc/html/rfc9457
 */

import type { Handler, HandlerContext, HandlerResult } from "#veryfront/types";
import { trace } from "@opentelemetry/api";
import { VeryfrontError } from "../types.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "../http-error.ts";
import { UNKNOWN_ERROR } from "../error-registry.ts";
import { getErrorMessage } from "../veryfront-error.ts";
import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { attachErrorToActiveSpan } from "../tracing.ts";

/**
 * Wrap a handler with error boundary that catches all errors and converts them
 * to RFC 9457 Problem Details responses.
 *
 * Behavior:
 * - VeryfrontError → toRFC9457() with application/problem+json
 * - Plain Error → wrap as unknown-error slug, then serialize
 * - Dev mode (isLocalProject): include stack field in response
 * - Production: omit stack, omit detail for 5xx errors
 *
 * @example
 * ```typescript
 * const handler: Handler = {
 *   metadata: { name: "api-handler", priority: HandlerPriority.MEDIUM },
 *   handle: httpErrorBoundary(async (req, ctx) => {
 *     // Your handler code that may throw
 *     return { response: new Response("OK") };
 *   }),
 * };
 * ```
 */
export function httpErrorBoundary(
  handlerFn: (req: Request, ctx: HandlerContext) => Promise<HandlerResult>,
): (req: Request, ctx: HandlerContext) => Promise<HandlerResult> {
  return async (req: Request, ctx: HandlerContext): Promise<HandlerResult> => {
    try {
      return await handlerFn(req, ctx);
    } catch (error) {
      // Convert error and record observability
      const vfError = error instanceof VeryfrontError ? error : wrapAsUnknownError(error);

      // Record error metrics with slug, category, and status
      recordErrorCount({
        slug: vfError.slug,
        category: vfError.category,
        status: String(vfError.status),
      });

      // Attach error to active OpenTelemetry span
      attachErrorToActiveSpan(vfError, trace);

      const response = errorToRFC9457Response(error, ctx, req);
      return { response };
    }
  };
}

/**
 * Wrap a complete Handler object with error boundary
 *
 * @example
 * ```typescript
 * export const myHandler = wrapHandlerWithErrorBoundary({
 *   metadata: { name: "my-handler", priority: HandlerPriority.MEDIUM },
 *   async handle(req, ctx) {
 *     // Handler code
 *   },
 * });
 * ```
 */
export function wrapHandlerWithErrorBoundary(handler: Handler): Handler {
  return {
    ...handler,
    handle: httpErrorBoundary(handler.handle.bind(handler)),
  };
}

/**
 * Convert any error to an RFC 9457 Response with environment-aware filtering
 */
function errorToRFC9457Response(
  error: unknown,
  ctx: HandlerContext,
  req: Request,
): Response {
  const isDev = !!ctx.isLocalProject;
  const instance = new URL(req.url).pathname;

  // Convert to VeryfrontError (or wrap as unknown-error)
  const vfError = error instanceof VeryfrontError ? error : wrapAsUnknownError(error);

  // Set instance if not already set
  if (!vfError.instance) {
    vfError.instance = instance;
  }

  // Serialize to RFC 9457
  const body = vfError.toRFC9457();

  // Apply environment-specific filtering
  if (!isDev) {
    // Production: omit stack
    delete (body as { stack?: string }).stack;

    // Production: omit detail for 5xx errors (may contain sensitive info)
    if (vfError.status >= 500) {
      delete body.detail;
    }
  } else {
    // Dev mode: include stack trace if available
    const stack = error instanceof Error ? error.stack : undefined;
    if (stack) {
      (body as { stack?: string }).stack = stack;
    }
  }

  return new Response(JSON.stringify(body, null, isDev ? 2 : undefined), {
    status: vfError.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
}

/**
 * Wrap any non-VeryfrontError as unknown-error slug
 */
function wrapAsUnknownError(error: unknown): VeryfrontError {
  const message = getErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;

  return UNKNOWN_ERROR.create({
    detail: message,
    cause,
  });
}
