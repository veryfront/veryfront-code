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
import { snapshotVeryfrontError } from "./error-snapshot.ts";
import { sanitizeErrorInstance } from "./sanitization.ts";
import { hasUnsafeControlCharacters } from "./text-validation.ts";

/**
 * Content-Type header for RFC 9457 responses
 */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";

/** Security headers applied to every problem-details response. */
export const PROBLEM_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": PROBLEM_JSON_CONTENT_TYPE,
  "X-Content-Type-Options": "nosniff",
});

/** Minimal request context accepted by the generated HTTP error handler. */
export interface ErrorHandlerContext {
  /** Request metadata used to derive the RFC 9457 instance path. */
  readonly req: {
    /** Absolute request URL. */
    readonly url: string;
  };
}

/** HTTP error handler returned by {@link createErrorHandler}. */
export type ErrorRequestHandler = (
  error: unknown,
  context: ErrorHandlerContext,
) => Response;

/**
 * Create an RFC 9457 compliant error Response
 */
export function createErrorResponse(error: VeryfrontError, instance?: string): Response {
  const snapshot = snapshotVeryfrontError(error);
  const body: RFC9457Response = {
    type: `https://veryfront.com/docs/errors/${snapshot.slug}`,
    title: snapshot.title,
    status: snapshot.status,
    category: snapshot.category,
    detail: snapshot.detail,
    instance: snapshot.instance,
    suggestion: snapshot.suggestion,
  };
  if (
    typeof instance === "string" && instance.length <= 4_096 &&
    !hasUnsafeControlCharacters(instance) && !body.instance
  ) {
    body.instance = sanitizeErrorInstance(instance);
  }

  if (body.status >= 500) {
    delete body.detail;
  }
  delete body.cause;

  return new Response(JSON.stringify(body), {
    status: snapshot.status,
    headers: PROBLEM_RESPONSE_HEADERS,
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
  try {
    const slug = params.slug;
    const title = params.title;
    const status = params.status;
    const category = params.category;
    const detail = params.detail;
    const instance = params.instance;
    const suggestion = params.suggestion;
    const cause = params.cause;
    const error = new VeryfrontError(title, {
      slug,
      title,
      status,
      category,
      detail,
      instance,
      suggestion,
      cause,
    });
    return createErrorResponse(error);
  } catch {
    throw new TypeError("Invalid problem response parameters");
  }
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
    return createErrorResponse(error, instance);
  }

  return createProblemResponse({
    slug: "unknown-error",
    title: "Unknown/unclassified error",
    status: 500,
    category: "GENERAL",
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
export function createErrorHandler(): ErrorRequestHandler {
  return (error: unknown, c: ErrorHandlerContext): Response => {
    let instance: string | undefined;
    try {
      instance = new URL(c.req.url).pathname;
    } catch {
      // Malformed request metadata must not replace the original error.
    }
    return errorToResponse(error, instance);
  };
}

/**
 * Log format for errors (matches the plan's log format spec)
 *
 * Format:
 * [ERROR] {slug} ({category}): {title}
 *   Detail: {detail}
 *   Suggestion: {suggestion}
 *   Docs: https://veryfront.com/docs/errors/{slug}
 */
export function formatErrorLog(error: VeryfrontError): string {
  const snapshot = snapshotVeryfrontError(error);
  const lines = [
    `[ERROR] ${snapshot.slug} (${snapshot.category}): ${snapshot.title}`,
  ];

  if (snapshot.detail) {
    lines.push(`  Detail: ${snapshot.detail}`);
  }

  if (snapshot.suggestion) {
    lines.push(`  Suggestion: ${snapshot.suggestion}`);
  }

  lines.push(`  Docs: https://veryfront.com/docs/errors/${snapshot.slug}`);

  return lines.join("\n");
}
