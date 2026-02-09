/**
 * Structured error logging for observability
 *
 * Provides unified error logging with slug-based identification, structured
 * fields for metrics/tracing integration, and environment-aware formatting.
 */

import { isProduction } from "#veryfront/build/config/environment.ts";
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
  const entry: ErrorLogEntry = {
    level: "error",
    slug: error.slug,
    category: error.category,
    title: error.title,
    detail: error.detail,
    suggestion: error.suggestion,
    status: error.status,
    docs: `https://veryfront.com/docs/errors/${error.slug}`,
    timestamp: new Date().toISOString(),
    context: context
      ? { ...(error.context as Record<string, unknown> ?? {}), ...context }
      : error.context as Record<string, unknown> | undefined,
  };

  if (isProduction()) {
    // Structured JSON for log aggregation systems
    console.error(JSON.stringify(entry));
  } else {
    // Human-readable format for development
    console.error(`[ERROR] ${error.slug} (${error.category}) — ${error.title}`);
    if (error.detail) {
      console.error(`  Detail: ${error.detail}`);
    }
    if (error.suggestion) {
      console.error(`  💡 Suggestion: ${error.suggestion}`);
    }
    console.error(`  📚 Docs: ${entry.docs}`);
    const mergedContext = context
      ? { ...(error.context as Record<string, unknown> ?? {}), ...context }
      : error.context;
    if (mergedContext) {
      console.error(`  Context: ${JSON.stringify(mergedContext, null, 2)}`);
    }
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
