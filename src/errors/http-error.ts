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
  type RegisteredError,
  type RFC9457Response,
  VeryfrontError,
} from "./types.ts";
import { getErrorMessage } from "./veryfront-error.ts";

/**
 * Content-Type header for RFC 9457 responses
 */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

/**
 * Create an RFC 9457 compliant error Response
 */
export function createErrorResponse(error: VeryfrontError): Response {
  const body = error.toRFC9457();

  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
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
  const body: RFC9457Response = {
    type: `https://veryfront.com/docs/errors/${params.slug}`,
    title: params.title,
    status: params.status,
    category: params.category,
    detail: params.detail,
    instance: params.instance,
    suggestion: params.suggestion,
    cause: params.cause,
  };

  return new Response(JSON.stringify(body), {
    status: params.status,
    headers: {
      "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
    },
  });
}

/**
 * Check if an error is a VeryfrontError with slug-based identity
 */
export function isVeryfrontError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError;
}

/**
 * Convert any error to an RFC 9457 Response
 *
 * - If it's a VeryfrontError with slug, serialize directly
 * - Otherwise, wrap in a generic "unknown-error" response
 */
export function errorToResponse(error: unknown, instance?: string): Response {
  if (isVeryfrontError(error)) {
    if (instance && !error.instance) {
      error.instance = instance;
    }
    return createErrorResponse(error);
  }

  // Wrap unknown errors
  const message = getErrorMessage(error);

  return createProblemResponse({
    slug: "unknown-error",
    title: "Unknown/unclassified error",
    status: 500,
    category: "GENERAL",
    detail: message,
    instance,
    suggestion: "Check logs for more details",
  });
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
    const instance = new URL(c.req.url).pathname;
    return errorToResponse(error, instance);
  };
}

/**
 * Log format for errors (matches the plan's log format spec)
 *
 * Format:
 * [ERROR] {slug} ({category}) — {title}
 *   Detail: {detail}
 *   Suggestion: {suggestion}
 *   Docs: https://veryfront.com/docs/errors/{slug}
 */
export function formatErrorLog(error: VeryfrontError): string {
  const lines = [`[ERROR] ${error.slug} (${error.category}) — ${error.title}`];

  if (error.detail) {
    lines.push(`  Detail: ${error.detail}`);
  }

  if (error.suggestion) {
    lines.push(`  Suggestion: ${error.suggestion}`);
  }

  lines.push(`  Docs: ${error.getDocsUrl()}`);

  return lines.join("\n");
}
