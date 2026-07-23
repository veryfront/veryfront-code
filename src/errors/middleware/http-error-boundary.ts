/**
 * HTTP Error Boundary Middleware
 *
 * Unified error catch → serialize → respond pipeline for HTTP boundaries.
 * Implements RFC 9457 (Problem Details for HTTP APIs) compliant error responses.
 *
 * @module errors/middleware/http-error-boundary
 * @see https://datatracker.ietf.org/doc/html/rfc9457
 */

import { trace } from "#veryfront/observability/tracing/api-shim.ts";
import { PROBLEM_RESPONSE_HEADERS } from "../http-error.ts";
import { recordErrorCount } from "#veryfront/observability/metrics/index.ts";
import { attachErrorToActiveSpan } from "../tracing.ts";
import { wrapUnknownError } from "./wrap-unknown.ts";
import { safeErrorStack, snapshotVeryfrontError } from "../error-snapshot.ts";

function safelyRecordError(error: ReturnType<typeof snapshotVeryfrontError>): void {
  try {
    recordErrorCount({
      slug: error.slug,
      category: error.category,
      status: String(error.status),
    });
  } catch {
    // Observability must not replace the application failure.
  }
}

/** Minimal request context required by the HTTP error boundary. */
export interface ErrorBoundaryContext {
  /** Whether diagnostic response fields may be emitted for local development. */
  readonly isLocalProject?: boolean;
}

/** Result shape returned by a response-producing HTTP handler. */
export interface ErrorBoundaryResult {
  /** Response produced by the handler, when request processing is complete. */
  readonly response?: Response;
  /** Whether the containing handler chain should continue. */
  readonly continue?: boolean;
  /** Optional low-level handler metadata. */
  readonly metadata?: Record<string, unknown>;
}

/** Handler shape accepted by {@link wrapHandlerWithErrorBoundary}. */
export interface ErrorBoundaryHandler<
  TMetadata = unknown,
  TContext extends ErrorBoundaryContext = ErrorBoundaryContext,
> {
  /** Metadata preserved by the wrapper. */
  readonly metadata: TMetadata;
  /** Process one request. */
  handle(req: Request, ctx: TContext): Promise<ErrorBoundaryResult>;
}

/**
 * Wrap a handler with error boundary that catches all errors and converts them
 * to RFC 9457 Problem Details responses.
 *
 * Behavior:
 * - VeryfrontError: snapshot validated fields into application/problem+json
 * - Plain Error: wrap as unknown-error, then snapshot and serialize
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
export function httpErrorBoundary<TContext extends ErrorBoundaryContext>(
  handlerFn: (req: Request, ctx: TContext) => Promise<ErrorBoundaryResult>,
): (req: Request, ctx: TContext) => Promise<ErrorBoundaryResult> {
  if (typeof handlerFn !== "function") throw new TypeError("handlerFn must be a function");
  return async (req: Request, ctx: TContext): Promise<ErrorBoundaryResult> => {
    try {
      return await handlerFn(req, ctx);
    } catch (error) {
      // Convert error and record observability
      const vfError = wrapUnknownError(error);
      const snapshot = snapshotVeryfrontError(vfError);

      // Record error metrics with slug, category, and status
      safelyRecordError(snapshot);

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
export function wrapHandlerWithErrorBoundary<
  TMetadata,
  TContext extends ErrorBoundaryContext,
>(
  handler: ErrorBoundaryHandler<TMetadata, TContext>,
): ErrorBoundaryHandler<TMetadata, TContext> {
  try {
    if (!handler || typeof handler !== "object" || typeof handler.handle !== "function") {
      throw new TypeError();
    }
    return {
      ...handler,
      handle: httpErrorBoundary(handler.handle.bind(handler)),
    };
  } catch {
    throw new TypeError("handler must provide a handle method");
  }
}

function isDevelopmentContext(ctx: ErrorBoundaryContext): boolean {
  try {
    return ctx?.isLocalProject === true;
  } catch {
    return false;
  }
}

/**
 * Convert any error to an RFC 9457 Response with environment-aware filtering
 *
 * Exported for reuse in route-executor and other HTTP boundaries that
 * need RFC 9457 responses without the full handler-wrapping middleware.
 */
export function errorToRFC9457Response(
  error: unknown,
  ctx: ErrorBoundaryContext,
  req: Request,
): Response {
  const isDev = isDevelopmentContext(ctx);
  let instance: string | undefined;
  try {
    instance = new URL(req.url).pathname;
  } catch {
    // A malformed request-like object must not replace the application failure.
  }

  // Convert to VeryfrontError (or wrap as unknown-error)
  const vfError = wrapUnknownError(error);
  const snapshot = snapshotVeryfrontError(vfError);

  // Serialize to RFC 9457
  const body = {
    type: `https://veryfront.com/docs/errors/${snapshot.slug}`,
    title: snapshot.title,
    status: snapshot.status,
    detail: snapshot.detail,
    instance: snapshot.instance,
    category: snapshot.category,
    suggestion: snapshot.suggestion,
  } as {
    type: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
    category: string;
    suggestion?: string;
    stack?: string;
  };
  if (!body.instance && instance !== undefined) {
    body.instance = instance;
  }

  // Apply environment-specific filtering
  if (!isDev) {
    // Production: omit stack
    delete (body as { stack?: string }).stack;

    // Production: omit detail for 5xx errors (may contain sensitive info)
    if (snapshot.status >= 500) {
      delete body.detail;
    }
  } else {
    // Dev mode: include stack trace if available
    const stack = error instanceof Error ? safeErrorStack(error) : undefined;
    if (stack) {
      body.stack = stack;
    }
  }

  return new Response(JSON.stringify(body, null, isDev ? 2 : undefined), {
    status: snapshot.status,
    headers: PROBLEM_RESPONSE_HEADERS,
  });
}
