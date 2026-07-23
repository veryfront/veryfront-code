import { INVALID_ARGUMENT } from "#veryfront/errors";

const MAX_TASK_ID_LENGTH = 255;
const TASK_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

/** Return whether a value is a canonical project task identifier. */
export function isCanonicalTaskId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TASK_ID_LENGTH &&
    TASK_ID_PATTERN.test(value) &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Validate and return a canonical project task identifier. */
export function normalizeTaskId(value: unknown, label = "Task id"): string {
  if (!isCanonicalTaskId(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `${label} must be a canonical lowercase identifier with safe path segments.`,
    });
  }
  return value;
}
