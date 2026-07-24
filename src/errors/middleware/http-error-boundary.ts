/**
 * HTTP Error Boundary Middleware
 *
 * Unified error catch → serialize → respond pipeline for HTTP boundaries.
 * Implements RFC 9457 (Problem Details for HTTP APIs) compliant error responses.
 *
 * @module errors/middleware/http-error-boundary
 * @see https://datatracker.ietf.org/doc/html/rfc9457
 */

import type { Handler, HandlerContext, HandlerResult } from "#veryfront/types/server.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "../http-error.ts";
import { extractRequestPathname } from "../request-instance.ts";
import { createSafeProblemDetails, stringifySafeProblemDetails } from "../safe-diagnostics.ts";
import { observeBoundaryErrorBestEffort } from "./boundary-observability.ts";
import { detachBoundaryError } from "./wrap-unknown.ts";

function isLocalProjectBestEffort(ctx: HandlerContext): boolean {
  try {
    return ctx.isLocalProject === true;
  } catch {
    return false;
  }
}

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
      const vfError = detachBoundaryError(error);
      observeBoundaryErrorBestEffort(vfError);

      const response = errorToRFC9457Response(vfError, ctx, req);
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
 *
 * Exported for reuse in route-executor and other HTTP boundaries that
 * need RFC 9457 responses without the full handler-wrapping middleware.
 */
export function errorToRFC9457Response(
  error: unknown,
  ctx: HandlerContext,
  req: Request,
): Response {
  const isDev = isLocalProjectBestEffort(ctx);
  const instance = extractRequestPathname(req);

  const body = createSafeProblemDetails(error, instance);

  // Apply environment-specific filtering
  if (!isDev) {
    // Production: omit stack
    delete body.stack;
    delete body.cause;

    // Production: omit detail for 5xx errors (may contain sensitive info)
    if (body.status >= 500) {
      delete body.detail;
    }
  }

  return new Response(stringifySafeProblemDetails(body, isDev), {
    status: body.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
}
