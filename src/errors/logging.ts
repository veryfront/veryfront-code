/**
 * Structured error logging for observability
 *
 * Provides unified error logging with slug-based identification, structured
 * fields for metrics/tracing integration, and environment-aware formatting.
 */

import { isProduction } from "#veryfront/platform/environment.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { redactSensitive } from "#veryfront/utils/logger/redact.ts";
import { VeryfrontError } from "./types.ts";

export interface ErrorLogEntry {
  level: "error";
  slug: string;
  category: string;
  title: string;
  detail?: string;
  suggestion?: string;
  status: number;
  docs: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

function toContextRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function mergeContext(
  errorContext: unknown,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const baseContext = toContextRecord(errorContext);

  if (!baseContext) return extraContext;
  if (!extraContext) return baseContext;

  return { ...baseContext, ...extraContext };
}

/**
 * Log a VeryfrontError with structured formatting
 *
 * In development: Human-readable multi-line format with colors
 * In production: Single-line JSON for log aggregation (Loki, etc.)
 *
 * @param error - The VeryfrontError to log
 * @param context - Additional context to include in logs
 */
export function logError(
  error: VeryfrontError,
  context?: Record<string, unknown>,
): void {
  const mergedContext = mergeContext(error.context, context);
  // Redact once and reuse for both the production JSON entry and the dev-mode
  // human-readable dump, so neither path can emit unredacted credentials.
  const safeContext = redactSensitive(mergedContext);
  const entry: ErrorLogEntry = {
    level: "error",
    slug: error.slug,
    category: error.category,
    title: error.title,
    detail: error.detail,
    suggestion: error.suggestion,
    status: error.status,
    docs: error.getDocsUrl(),
    timestamp: new Date().toISOString(),
    context: safeContext,
  };

  if (isProduction()) {
    // Route through the canonical logger so the JSON envelope, redaction pipeline,
    // and OTel log-record bridge all apply. Error-specific fields (slug, category,
    // status, docs) travel as structured context.
    serverLogger.error(error.title, {
      ...(safeContext ?? {}),
      slug: error.slug,
      category: error.category,
      ...(error.detail && { detail: error.detail }),
      ...(error.suggestion && { suggestion: error.suggestion }),
      status: error.status,
      docs: entry.docs,
    });
  } else {
    // Single-line summary always visible at error level.
    const summary = error.suggestion ? `${error.title} - ${error.suggestion}` : error.title;
    serverLogger.error(summary);

    // Full diagnostic detail at debug level - visible with --debug / LOG_LEVEL=DEBUG.
    serverLogger.debug(`[${error.slug}] ${error.category}`, {
      ...(error.detail && { detail: error.detail }),
      docs: entry.docs,
      ...(safeContext ? { context: safeContext } : {}),
    });
  }
}

/**
 * Log an error with a custom message prefix
 *
 * Useful for adding operation context to error logs.
 *
 * @param message - Prefix message describing the operation
 * @param error - The VeryfrontError to log
 * @param context - Additional context to include
 */
export function logErrorWithMessage(
  message: string,
  error: VeryfrontError,
  context?: Record<string, unknown>,
): void {
  const extendedContext = {
    ...context,
    operation: message,
  };
  logError(error, extendedContext);
}
