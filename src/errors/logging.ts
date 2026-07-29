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
  sanitizeDiagnosticText,
  snapshotErrorForLoggingBoundary,
} from "./safe-diagnostics.ts";

const arrayIsArray = Array.isArray;
const jsonStringify = JSON.stringify;
const NativeDate = Date;

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
    return arrayIsArray(value) ? undefined : value as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function redactAndMergeContext(
  redactedErrorContext: unknown,
  extraContext?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const baseContext = toContextRecord(redactedErrorContext);
  const safeExtraContext = toContextRecord(redactForSerialization(extraContext));

  const merged = !baseContext
    ? safeExtraContext
    : !safeExtraContext
    ? baseContext
    : { ...baseContext, ...safeExtraContext };
  if (!merged) return undefined;

  try {
    return jsonStringify(merged).length <= ERROR_CONTEXT_MAX_LENGTH_CHARS
      ? merged
      : { context_truncated: true };
  } catch {
    return { unreadable_context: "[REDACTED]" };
  }
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
  const boundary = snapshotErrorForLoggingBoundary(error);
  const snapshot = boundary.error;
  const slug = sanitizeDiagnosticText(snapshot.slug);
  const safeContext = redactAndMergeContext(boundary.context, context);
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
    timestamp: new NativeDate().toISOString(),
    context: safeContext,
  };

  if (isProduction()) {
    // Route through the canonical logger so the JSON envelope, redaction pipeline,
    // and OTel log-record bridge all apply. Error-specific fields (slug, category,
    // status, docs) travel as structured context.
    serverLogger.error(entry.title, {
      ...(safeContext ?? {}),
      slug: entry.slug,
      category: entry.category,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
      ...(entry.suggestion !== undefined ? { suggestion: entry.suggestion } : {}),
      status: entry.status,
      docs: entry.docs,
    });
  } else {
    // Single-line summary always visible at error level.
    const summary = entry.suggestion ? `${entry.title} - ${entry.suggestion}` : entry.title;
    serverLogger.error(summary);

    // Full diagnostic detail at debug level - visible with --debug / LOG_LEVEL=DEBUG.
    serverLogger.debug(`[${entry.slug}] ${entry.category}`, {
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
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
  const safeContext = toContextRecord(redactForSerialization(context));
  const extendedContext = {
    ...safeContext,
    operation: sanitizeDiagnosticText(message),
  };
  logError(error, extendedContext);
}
