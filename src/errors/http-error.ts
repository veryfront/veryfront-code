/**
 * HTTP Error Response Utilities
 *
 * Provides RFC 9457 (Problem Details for HTTP APIs) compliant error responses.
 *
 * @module errors/http-error
 * @see https://datatracker.ietf.org/doc/html/rfc9457
 */

import {
  type ErrorCategory,
  isVeryfrontErrorInstance,
  type RegisteredError,
  type RFC9457Response,
  VeryfrontError,
} from "./types.ts";
import {
  buildErrorDocsUrl,
  createSafeProblemDetails,
  limitRenderedErrorOutput,
  sanitizeTerminalDiagnosticText,
  snapshotErrorForBoundary,
  stringifySafeProblemDetails,
} from "./safe-diagnostics.ts";
import { extractHandlerRequestPathname } from "./request-instance.ts";

/**
 * Content-Type header for RFC 9457 responses
 */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

function createProblemDetailsResponse(body: RFC9457Response): Response {
  return new Response(stringifySafeProblemDetails(body), {
    status: body.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
}

/**
 * Create an RFC 9457 compliant error Response
 */
export function createErrorResponse(error: VeryfrontError): Response {
  const body = createSafeProblemDetails(error);
  delete body.stack;
  return createProblemDetailsResponse(body);
}

/**
 * Create an RFC 9457 error Response from a registered error definition
 */
export function createErrorResponseFromDefinition(
  errorDef: RegisteredError,
  options?: {
    detail?: string;
    instance?: string;
    cause?: string;
  },
): Response {
  const error = errorDef.create(options);
  return createErrorResponse(error);
}

/**
 * Create an RFC 9457 error Response from raw parameters
 */
export function createProblemResponse(params: {
  slug: string;
  title: string;
  status: number;
  category: ErrorCategory;
  detail?: string;
  instance?: string;
  suggestion?: string;
  cause?: string;
}): Response {
  const error = new VeryfrontError(params.title, {
    slug: params.slug,
    title: params.title,
    status: params.status,
    category: params.category,
    detail: params.detail,
    instance: params.instance,
    suggestion: params.suggestion,
    cause: params.cause,
  });
  return createErrorResponse(error);
}

/**
 * Check if an error is a VeryfrontError with slug-based identity
 */
export function isVeryfrontError(error: unknown): error is VeryfrontError {
  return isVeryfrontErrorInstance(error);
}

/**
 * Convert any error to an RFC 9457 Response
 *
 * - If it's a VeryfrontError with slug, serialize directly
 * - Otherwise, wrap in a generic "unknown-error" response
 */
export function errorToResponse(error: unknown, instance?: string): Response {
  const body = createSafeProblemDetails(error, instance);
  delete body.cause;
  delete body.stack;

  if (body.status >= 500) {
    delete body.detail;
  }

  return createProblemDetailsResponse(body);
}

/**
 * Express/Hono-style error handler middleware factory
 *
 * Usage:
 * ```typescript
 * app.onError(createErrorHandler());
 * ```
 */
export function createErrorHandler() {
  return (error: unknown, c: { req: { url: string } }): Response => {
    const instance = extractHandlerRequestPathname(c);
    return errorToResponse(error, instance);
  };
}

/**
 * Log format for errors (matches the plan's log format spec)
 *
 * Format:
 * [ERROR] {slug} ({category}) - {title}
 *   Detail: {detail}
 *   Suggestion: {suggestion}
 *   Docs: https://veryfront.com/docs/errors/{slug}
 */
export function formatErrorLog(error: VeryfrontError): string {
  const snapshot = snapshotErrorForBoundary(error);
  const slug = sanitizeTerminalDiagnosticText(snapshot.slug);
  const docsUrl = buildErrorDocsUrl(snapshot.slug);
  const lines = [
    `[ERROR] ${slug} (${snapshot.category}) - ${sanitizeTerminalDiagnosticText(snapshot.title)}`,
  ];

  if (snapshot.detail) {
    lines.push(`  Detail: ${sanitizeTerminalDiagnosticText(snapshot.detail)}`);
  }

  if (snapshot.suggestion) {
    lines.push(`  Suggestion: ${sanitizeTerminalDiagnosticText(snapshot.suggestion)}`);
  }

  lines.push(`  Docs: ${docsUrl}`);

  return limitRenderedErrorOutput(lines.join("\n"));
}
