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
  // Character loop, not replaceAll: task code may have replaced String methods in the shared realm.
  const text = `${segment}`;
  let escaped = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    escaped += char === "~" ? "~0" : char === "/" ? "~1" : char;
  }
  return escaped;
}

/** Convert schema issues to JSON Pointer validation errors, capped at {@link MAX_SCHEMA_VALIDATION_ERRORS}. */
export function toSchemaValidationErrors(
  issues: readonly ValidationIssue[],
): SchemaValidationError[] {
  // Index loops and string concatenation only: task code may have replaced Array methods in the
  // shared realm, and reporting a validation failure must not throw because of it.
  const errors: SchemaValidationError[] = [];
  const count = issues.length < MAX_SCHEMA_VALIDATION_ERRORS
    ? issues.length
    : MAX_SCHEMA_VALIDATION_ERRORS;
  for (let index = 0; index < count; index++) {
    const issue = issues[index]!;
    let path = "";
    for (let segment = 0; segment < issue.path.length; segment++) {
      path += `/${escapePointerSegment(issue.path[segment]!)}`;
    }
    errors[errors.length] = { path, message: issue.message };
  }
  return errors;
}

/** One-line summary, e.g. `/amount: Expected number; <root>: Required`. */
export function formatSchemaValidationErrors(errors: readonly SchemaValidationError[]): string {
  let summary = "";
  for (let index = 0; index < errors.length; index++) {
    const error = errors[index]!;
    summary += `${index === 0 ? "" : "; "}${error.path || "<root>"}: ${error.message}`;
  }
  return summary;
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
