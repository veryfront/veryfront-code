import {
  type RFC9457Response,
  snapshotVeryfrontError,
  type VeryfrontErrorSnapshot,
} from "./types.ts";
import { snapshotError, snapshotErrorAsError } from "./veryfront-error.ts";
import {
  buildErrorDocsUrl,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  sanitizeBoundedDiagnosticText,
  sanitizeBoundedErrorSlug,
  sanitizeBoundedStackText,
  sanitizeBoundedTerminalText,
} from "./diagnostic-policy.ts";

export {
  buildErrorDocsUrl,
  ERROR_CONTEXT_MAX_LENGTH_CHARS,
  ERROR_DIAGNOSTIC_MAX_LENGTH_CHARS,
  ERROR_DOCS_BASE_URL,
  ERROR_DOCS_SLUG_MAX_LENGTH_CHARS,
  ERROR_OUTPUT_MAX_LENGTH_CHARS,
  ERROR_STACK_MAX_LENGTH_CHARS,
  limitRenderedErrorOutput,
  sanitizeBoundedErrorSlug,
} from "./diagnostic-policy.ts";

const UNKNOWN_ERROR_SNAPSHOT: VeryfrontErrorSnapshot = Object.freeze({
  slug: "unknown-error",
  category: "GENERAL",
  status: 500,
  title: "Unknown/unclassified error",
  message: "Unknown/unclassified error",
  suggestion: "Check logs for more details",
});

function isProblemDetailsResponseStatus(status: number): boolean {
  return Number.isInteger(status) &&
    status >= 200 &&
    status <= 599 &&
    status !== 204 &&
    status !== 205 &&
    status !== 304;
}

/** Mask credentials embedded in arbitrary diagnostic text. */
export function sanitizeDiagnosticText(value: unknown): string {
  return sanitizeBoundedDiagnosticText(value);
}

/**
 * Prepare one untrusted diagnostic field for terminal or plain-text output.
 * Apply framework-owned ANSI styling only after this sanitizer returns.
 */
export function sanitizeTerminalDiagnosticText(value: unknown): string {
  return sanitizeBoundedTerminalText(value);
}

/** Mask credentials and apply the larger shared stack bound. */
export function sanitizeStackDiagnosticText(value: unknown): string {
  return sanitizeBoundedStackText(value);
}

export function sanitizeOptionalDiagnosticText(value: unknown): string | undefined {
  return value === undefined ? undefined : sanitizeDiagnosticText(value);
}

/**
 * Snapshot a throwable once and return a stable Veryfront-shaped diagnostic.
 *
 * Invalid or unreadable VeryfrontError proxies degrade to the canonical
 * unknown-error identity. Plain errors contribute only a safely-read message
 * and stack.
 */
export function snapshotErrorForBoundary(error: unknown): VeryfrontErrorSnapshot {
  const stableError = snapshotErrorAsError(error);
  const veryfrontSnapshot = snapshotVeryfrontError(stableError);
  const candidate = veryfrontSnapshot ?? (() => {
    const nativeSnapshot = snapshotError(stableError);
    const message = nativeSnapshot?.message ?? "Unknown error";
    return {
      ...UNKNOWN_ERROR_SNAPSHOT,
      detail: message,
      stack: nativeSnapshot?.stack,
    };
  })();

  return {
    ...candidate,
    slug: sanitizeBoundedErrorSlug(candidate.slug),
    title: sanitizeDiagnosticText(candidate.title),
    message: sanitizeDiagnosticText(candidate.message),
    suggestion: sanitizeOptionalDiagnosticText(candidate.suggestion),
    detail: sanitizeOptionalDiagnosticText(candidate.detail),
    cause: typeof candidate.cause === "string"
      ? sanitizeDiagnosticText(candidate.cause)
      : candidate.cause,
    instance: sanitizeOptionalDiagnosticText(candidate.instance),
    stack: candidate.stack === undefined ? undefined : sanitizeStackDiagnosticText(candidate.stack),
  };
}

export interface SafeProblemDetails extends RFC9457Response {
  stack?: string;
}

/** Build a credential-scrubbed RFC 9457 snapshot without calling error methods. */
export function createSafeProblemDetails(
  error: unknown,
  instance?: string,
): SafeProblemDetails {
  const candidate = snapshotErrorForBoundary(error);
  const snapshot = isProblemDetailsResponseStatus(candidate.status) ? candidate : {
    ...UNKNOWN_ERROR_SNAPSHOT,
    detail: candidate.detail ?? candidate.message,
    stack: candidate.stack,
  };

  return {
    type: buildErrorDocsUrl(snapshot.slug),
    title: sanitizeDiagnosticText(snapshot.title),
    status: snapshot.status,
    detail: sanitizeOptionalDiagnosticText(snapshot.detail),
    instance: sanitizeOptionalDiagnosticText(snapshot.instance ?? instance),
    category: snapshot.category,
    suggestion: sanitizeOptionalDiagnosticText(snapshot.suggestion),
    cause: typeof snapshot.cause === "string" ? sanitizeDiagnosticText(snapshot.cause) : undefined,
    stack: snapshot.stack === undefined ? undefined : sanitizeStackDiagnosticText(snapshot.stack),
  };
}

/**
 * Serialize a problem-details object without allowing optional diagnostics to
 * amplify one response beyond the shared output budget.
 */
export function stringifySafeProblemDetails(
  body: SafeProblemDetails,
  pretty = false,
): string {
  const bounded = { ...body };
  const serialize = (): string => JSON.stringify(bounded, null, pretty ? 2 : undefined);
  let serialized = serialize();
  if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;

  for (const key of ["stack", "cause", "detail", "instance", "suggestion"] as const) {
    delete bounded[key];
    serialized = serialize();
    if (serialized.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS) return serialized;
  }

  return JSON.stringify(
    {
      type: buildErrorDocsUrl(UNKNOWN_ERROR_SNAPSHOT.slug),
      title: UNKNOWN_ERROR_SNAPSHOT.title,
      status: UNKNOWN_ERROR_SNAPSHOT.status,
      category: UNKNOWN_ERROR_SNAPSHOT.category,
    },
    null,
    pretty ? 2 : undefined,
  );
}
