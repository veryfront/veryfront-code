import type { ErrorCategory, VeryfrontError } from "./types.ts";
import { sanitizeErrorContext, sanitizeErrorInstance, sanitizeErrorText } from "./sanitization.ts";
import { hasUnsafeControlCharacters } from "./text-validation.ts";

const ERROR_CATEGORIES: ReadonlySet<string> = new Set<ErrorCategory>([
  "CONFIG",
  "BUILD",
  "RUNTIME",
  "ROUTE",
  "MODULE",
  "SERVER",
  "BOUNDARY",
  "DEV",
  "DEPLOY",
  "AGENT",
  "GENERAL",
]);
const ERROR_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Immutable, validated projection used at external error boundaries. */
export interface ErrorBoundarySnapshot {
  readonly slug: string;
  readonly category: ErrorCategory;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly suggestion?: string;
  readonly instance?: string;
  readonly context?: Record<string, unknown>;
  readonly cause?: unknown;
}

const UNKNOWN_ERROR_SNAPSHOT: ErrorBoundarySnapshot = Object.freeze({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});

function requiredString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
  allowFormattingWhitespace = false,
): string {
  if (
    typeof value !== "string" || value.length > maximumLength ||
    (!allowEmpty && value.trim().length === 0) ||
    hasUnsafeControlCharacters(value, allowFormattingWhitespace)
  ) {
    throw new TypeError("Invalid error text");
  }
  return value;
}

function optionalString(
  value: unknown,
  maximumLength: number,
  allowFormattingWhitespace = false,
): string | undefined {
  return value === undefined
    ? undefined
    : requiredString(value, maximumLength, true, allowFormattingWhitespace);
}

/**
 * Snapshot a potentially mutated error instance without invoking its methods.
 * Invalid or hostile properties collapse to the stable unknown-error identity.
 */
export function snapshotVeryfrontError(error: VeryfrontError): ErrorBoundarySnapshot {
  try {
    const slug = requiredString(error.slug, 128);
    const category = error.category;
    const status = error.status;
    const title = requiredString(error.title, 512);
    const detail = optionalString(error.detail, 16_384, true);
    const suggestion = optionalString(error.suggestion, 4_096);
    const instance = optionalString(error.instance, 4_096);
    const context = error.context;
    const cause = error.cause;

    if (!ERROR_SLUG_PATTERN.test(slug)) throw new TypeError("Invalid error slug");
    if (typeof category !== "string" || !ERROR_CATEGORIES.has(category)) {
      throw new TypeError("Invalid error category");
    }
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new TypeError("Invalid error status");
    }

    return Object.freeze({
      slug,
      category: category as ErrorCategory,
      status,
      title: sanitizeErrorText(title, 512),
      detail: detail === undefined ? undefined : sanitizeErrorText(detail),
      suggestion: suggestion === undefined ? undefined : sanitizeErrorText(suggestion),
      instance: instance === undefined ? undefined : sanitizeErrorInstance(instance),
      context: sanitizeErrorContext(context),
      cause,
    });
  } catch {
    return UNKNOWN_ERROR_SNAPSHOT;
  }
}

/** Read and sanitize an Error stack without trusting a mutable accessor. */
export function safeErrorStack(error: Error): string | undefined {
  try {
    return typeof error.stack === "string" ? sanitizeErrorText(error.stack, 16_384) : undefined;
  } catch {
    return undefined;
  }
}
