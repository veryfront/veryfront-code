import { sanitizeLogText } from "#veryfront/utils/logger/core.ts";
import { REDACTED, sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";

/** Maximum characters retained from one diagnostic field. */
export const ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS = 2_048;
/** Maximum characters retained from a stack snapshot. */
export const ERROR_STACK_MAX_LENGTH_CHARS = 8_192;
/** Maximum characters retained from serialized structured error context. */
export const ERROR_CONTEXT_MAX_LENGTH_CHARS = 4_096;
/** Maximum characters emitted by one rendered error payload or terminal block. */
export const ERROR_OUTPUT_MAX_LENGTH_CHARS = 64 * 1_024;
/** Maximum source characters accepted for the error-docs path segment. */
export const ERROR_DOCS_SLUG_MAX_LENGTH_CHARS = 256;

export const ERROR_DOCS_BASE_URL = "https://veryfront.com/docs/errors/";

const TRUNCATION_MARKER = "...[truncated]";
const UNKNOWN_ERROR_SLUG = "unknown-error";

function truncateDiagnosticText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;

  const prefixLength = Math.max(0, maxLength - TRUNCATION_MARKER.length);
  const prefix = takeSafePrefix(value, prefixLength);
  return `${prefix}${TRUNCATION_MARKER}`;
}

function takeSafePrefix(value: string, length: number): string {
  let prefix = value.slice(0, length);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function replaceLoneSurrogates(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        result += value.slice(index, index + 2);
        index++;
      } else {
        result += "\ufffd";
      }
      continue;
    }
    result += codeUnit >= 0xdc00 && codeUnit <= 0xdfff ? "\ufffd" : value.charAt(index);
  }

  return result;
}

/**
 * Redact a complete diagnostic before truncating it.
 *
 * The order is security-sensitive: truncating first could split a credential
 * assignment before the redactor sees its complete value and expose a prefix.
 */
export function sanitizeBoundedDiagnosticText(value: unknown): string {
  if (typeof value !== "string") return REDACTED;
  return truncateDiagnosticText(
    sanitizeUrlCredentials(value),
    ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  );
}

/** Redact and bound a stack while retaining its line structure. */
export function sanitizeBoundedStackText(value: unknown): string {
  if (typeof value !== "string") return REDACTED;
  return truncateDiagnosticText(
    sanitizeUrlCredentials(value),
    ERROR_STACK_MAX_LENGTH_CHARS,
  );
}

/** Redact, neutralize terminal controls, and bound one terminal field. */
export function sanitizeBoundedTerminalText(value: unknown): string {
  const redacted = typeof value === "string" ? sanitizeUrlCredentials(value) : REDACTED;
  if (redacted.length <= ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS) {
    return sanitizeLogText(redacted);
  }

  const prefixLength = ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS -
    TRUNCATION_MARKER.length;
  return `${sanitizeLogText(takeSafePrefix(redacted, prefixLength))}${TRUNCATION_MARKER}`;
}

/**
 * Bound a complete rendered terminal block.
 *
 * Normal-sized output retains framework styling. Oversized output is flattened
 * through the terminal sanitizer before truncation so a cut cannot leave an
 * incomplete ANSI sequence active in the caller's terminal.
 */
export function limitRenderedErrorOutput(value: string): string {
  if (value.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return value;
  return truncateDiagnosticText(
    sanitizeLogText(value),
    ERROR_OUTPUT_MAX_LENGTH_CHARS,
  );
}

/** Redact and bound an error identity consistently across every boundary. */
export function sanitizeBoundedErrorSlug(slug: unknown): string {
  const sanitized = typeof slug === "string" ? sanitizeUrlCredentials(slug) : UNKNOWN_ERROR_SLUG;
  const bounded = truncateDiagnosticText(
    sanitized || UNKNOWN_ERROR_SLUG,
    ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  );
  const normalized = replaceLoneSurrogates(bounded);
  return normalized === "." || normalized === ".." ? UNKNOWN_ERROR_SLUG : normalized;
}

/** Build a single, encoded, credential-scrubbed error documentation path. */
export function buildErrorDocsUrl(slug: unknown): string {
  const segment = encodeURIComponent(sanitizeBoundedErrorSlug(slug));
  return `${ERROR_DOCS_BASE_URL}${segment}`;
}
