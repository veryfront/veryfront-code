/**
 * Structured error logging for observability
 *
 * Provides unified error logging with slug-based identification, structured
 * fields for metrics/tracing integration, and environment-aware formatting.
 */

import { isProduction } from "#veryfront/platform/environment.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { sanitizeErrorContext, sanitizeErrorText } from "./sanitization.ts";
import type { ErrorCategory, VeryfrontError } from "./types.ts";
import { snapshotVeryfrontError } from "./error-snapshot.ts";

/** Sanitized structured error record emitted in production. */
export interface ErrorLogEntry {
  /** Fixed error severity. */
  level: "error";
  /** Stable registered error slug. */
  slug: string;
  /** Error category. */
  category: ErrorCategory;
  /** Stable error title. */
  title: string;
  /** Sanitized occurrence detail. */
  detail?: string;
  /** Sanitized corrective action. */
  suggestion?: string;
  /** Associated HTTP status. */
  status: number;
  /** Error documentation URL. */
  docs: string;
  /** ISO timestamp for the log entry. */
  timestamp: string;
  /** Sanitized structured context. */
  context?: Record<string, unknown>;
}

function mergeContext(
  errorContext: unknown,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const baseContext = sanitizeErrorContext(errorContext);
  const safeExtraContext = sanitizeErrorContext(extraContext);

  if (!baseContext) return safeExtraContext;
  if (!safeExtraContext) return baseContext;

  return { ...baseContext, ...safeExtraContext };
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
  const snapshot = snapshotVeryfrontError(error);
  const mergedContext = mergeContext(snapshot.context, context);
  // Redact once and reuse for both the production JSON entry and the dev-mode
  // human-readable dump, so neither path can emit unredacted credentials.
  const safeContext = sanitizeErrorContext(mergedContext);
  const entry: ErrorLogEntry = {
    level: "error",
    slug: snapshot.slug,
    category: snapshot.category,
    title: snapshot.title,
    detail: snapshot.detail,
    suggestion: snapshot.suggestion,
    status: snapshot.status,
    docs: `https://veryfront.com/docs/errors/${snapshot.slug}`,
    timestamp: new Date().toISOString(),
    context: safeContext,
  };

  if (isProduction()) {
    // Direct JSON output. This module owns its own structured format
    // (slug, category, status, docs) which differs from the logger envelope.
    try {
      console.error(JSON.stringify(entry));
    } catch {
      try {
        console.error(JSON.stringify({
          level: "error",
          slug: snapshot.slug,
          category: snapshot.category,
          status: snapshot.status,
        }));
      } catch {
        // Logging failures must not replace the application flow.
      }
    }
  } else {
    // Human-readable format for development
    const safelyEmit = (message: string): void => {
      try {
        serverLogger.error(message);
      } catch {
        // Logging failures must not replace the application flow.
      }
    };
    safelyEmit(`[ERROR] ${snapshot.slug} (${snapshot.category}): ${entry.title}`);
    if (entry.detail) {
      safelyEmit(`  Detail: ${entry.detail}`);
    }
    if (entry.suggestion) {
      safelyEmit(`  💡 Suggestion: ${entry.suggestion}`);
    }
    safelyEmit(`  📚 Docs: ${entry.docs}`);
    if (safeContext) {
      try {
        safelyEmit(`  Context: ${JSON.stringify(safeContext, null, 2)}`);
      } catch {
        // Sanitization already fails closed; this covers a hostile runtime serializer.
      }
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
  const safeContext = sanitizeErrorContext(context);
  const extendedContext = {
    ...(safeContext ?? {}),
    operation: sanitizeErrorText(message, 512),
  };
  logError(error, extendedContext);
}
