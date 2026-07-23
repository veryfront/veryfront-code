import { createEvalValidationError } from "./validation.ts";

const EVAL_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

function createEvalRunIdSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Validate a caller-provided eval run id before it reaches reports or filesystem consumers. */
export function assertValidEvalRunId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !EVAL_RUN_ID_PATTERN.test(value)) {
    throw createEvalValidationError(
      "Eval run id must contain 1 to 256 letters, numbers, periods, underscores, or hyphens",
    );
  }
}

/** Validate a date used to timestamp an eval run or report. */
export function assertValidEvalDate(value: unknown): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw createEvalValidationError("Eval run date must be valid");
  }
}

/** Create a timestamp-sortable eval run id with a collision-resistant suffix. */
export function createEvalRunId(
  now = new Date(),
  createSuffix: () => string = createEvalRunIdSuffix,
): string {
  assertValidEvalDate(now);
  const suffix = createSuffix();
  if (typeof suffix !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(suffix)) {
    throw createEvalValidationError(
      "Eval run id suffix must contain 8 to 128 letters, numbers, underscores, or hyphens",
    );
  }
  const timestamp = now.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "");
  return `evalrun_${timestamp}_${suffix}`;
}
