/**
 * Validation errors reported on a run that fails `INPUT_VALIDATION_FAILED`
 * (veryfront/veryfront-issue-inbox#2091): `{ path, message }` with `path` as a
 * JSON Pointer, the same shape the task path reports.
 *
 * @module schemas/validation-errors
 */

import type { ValidationIssue } from "#veryfront/extensions/schema/index.ts";

/** At most this many validation errors are kept on a failed run. */
export const MAX_SCHEMA_VALIDATION_ERRORS = 20;

/** Machine-readable code of a run whose input fails its declared inputSchema. */
export const INPUT_VALIDATION_FAILED_CODE = "INPUT_VALIDATION_FAILED";

export interface SchemaValidationError {
  /** JSON Pointer to the invalid value, `""` for the root. */
  path: string;
  message: string;
}

/** Escape one JSON Pointer reference token (RFC 6901). */
export function escapePointerSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Convert schema issues to JSON Pointer validation errors, capped at {@link MAX_SCHEMA_VALIDATION_ERRORS}. */
export function toSchemaValidationErrors(
  issues: readonly ValidationIssue[],
): SchemaValidationError[] {
  return issues.slice(0, MAX_SCHEMA_VALIDATION_ERRORS).map((issue) => ({
    path: issue.path.length === 0 ? "" : `/${issue.path.map(escapePointerSegment).join("/")}`,
    message: issue.message,
  }));
}

/** One-line summary, e.g. `/amount: Expected number; <root>: Required`. */
export function formatSchemaValidationErrors(errors: readonly SchemaValidationError[]): string {
  return errors.map((error) => `${error.path || "<root>"}: ${error.message}`).join("; ");
}

/** Read validation errors back from an `INPUT_VALIDATION_FAILED` error's context. */
export function readSchemaValidationErrors(value: unknown): SchemaValidationError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid = value.every((entry) =>
    typeof entry === "object" && entry !== null &&
    typeof (entry as { path?: unknown }).path === "string" &&
    typeof (entry as { message?: unknown }).message === "string"
  );
  return valid ? value as SchemaValidationError[] : undefined;
}
