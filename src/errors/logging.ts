/**
 * Structured error logging for observability
 *
 * Provides unified error logging with slug-based identification, structured
 * fields for metrics/tracing integration, and environment-aware formatting.
 */

import { isProduction } from "#veryfront/platform/environment.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { redactForSerialization } from "#veryfront/utils/logger/redact.ts";
import { VeryfrontError } from "./types.ts";
import {
  buildErrorDocsUrl,
  ERROR_CONTEXT_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  sanitizeDiagnosticText,
  snapshotErrorForBoundary,
} from "./safe-diagnostics.ts";

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
  if (!value || typeof value !== "object") return undefined;
  try {
    return Array.isArray(value) ? undefined : value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function redactAndMergeContext(
  errorContext: unknown,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const baseContext = toContextRecord(redactForSerialization(errorContext));
  const safeExtraContext = toContextRecord(redactForSerialization(extraContext));

  const merged = !baseContext
    ? safeExtraContext
    : !safeExtraContext
    ? baseContext
    : { ...baseContext, ...safeExtraContext };
  if (!merged) return undefined;

  try {
    return JSON.stringify(merged).length <= ERROR_CONTEXT_MAX_LENGTH_CHARS
      ? merged
      : { context_truncated: true };
  } catch {
    return { unreadable_context: "[REDACTED]" };
  }
}

function stringifyErrorLogEntry(entry: ErrorLogEntry): string {
  const serialized = JSON.stringify(entry);
  if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;

  return JSON.stringify(
    {
      level: entry.level,
      slug: entry.slug,
      category: entry.category,
      title: entry.title,
      status: entry.status,
      docs: entry.docs,
      timestamp: entry.timestamp,
      context: { context_truncated: true },
    } satisfies ErrorLogEntry,
  );
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
  const snapshot = snapshotErrorForBoundary(error);
  const slug = sanitizeDiagnosticText(snapshot.slug);
  const safeContext = redactAndMergeContext(snapshot.context, context);
  const entry: ErrorLogEntry = {
    level: "error",
    slug,
    category: snapshot.category,
    title: sanitizeDiagnosticText(snapshot.title),
    detail: snapshot.detail === undefined ? undefined : sanitizeDiagnosticText(snapshot.detail),
    suggestion: snapshot.suggestion === undefined
      ? undefined
      : sanitizeDiagnosticText(snapshot.suggestion),
    status: snapshot.status,
    docs: buildErrorDocsUrl(snapshot.slug),
    timestamp: new Date().toISOString(),
    context: safeContext,
  };

  if (isProduction()) {
    // Direct JSON output - this module owns its own structured format
    // (slug, category, status, docs) which differs from the logger envelope.
    console.error(stringifyErrorLogEntry(entry));
  } else {
    // Human-readable format for development
    serverLogger.error(`[ERROR] ${entry.slug} (${entry.category}) - ${entry.title}`);
    if (entry.detail) {
      serverLogger.error(`  Detail: ${entry.detail}`);
    }
    if (entry.suggestion) {
      serverLogger.error(`  💡 Suggestion: ${entry.suggestion}`);
    }
    serverLogger.error(`  📚 Docs: ${entry.docs}`);
    if (safeContext) {
      serverLogger.error(`  Context: ${JSON.stringify(safeContext, null, 2)}`);
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
  const safeContext = toContextRecord(redactForSerialization(context));
  const extendedContext = {
    ...safeContext,
    operation: sanitizeDiagnosticText(message),
  };
  logError(error, extendedContext);
}
