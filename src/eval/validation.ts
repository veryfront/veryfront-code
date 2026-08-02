import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import type { EvalExample, EvalExampleInput } from "./types.ts";

const ArrayIsArray = Array.isArray;

export function createEvalValidationError(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

export function stringifyEvalError(value: unknown): string {
  try {
    if (value instanceof Error && typeof value.message === "string" && value.message.length > 0) {
      return value.message;
    }
  } catch {
    // Continue through the total fallbacks for hostile thrown values.
  }
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Continue to String, which handles symbols and most non-JSON values.
  }
  try {
    return String(value);
  } catch {
    return "[unprintable thrown value]";
  }
}

export function isEvalRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    return false;
  }
  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === undefined || isEvalRecord(value)) return;
  throw createEvalValidationError(`${label} metadata must be an object when provided`);
}

export function normalizeEvalString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw createEvalValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function assertCanonicalEvalString(
  value: unknown,
  label: string,
): asserts value is string {
  const normalized = normalizeEvalString(value, label);
  if (normalized !== value) {
    throw createEvalValidationError(`${label} must not have surrounding whitespace`);
  }
}

function isEvalArray(value: unknown): value is unknown[] {
  // Array.isArray throws on revoked proxies; report those as non-arrays so the
  // caller raises its structured validation error instead of a raw TypeError.
  try {
    return ArrayIsArray(value);
  } catch {
    return false;
  }
}

export function normalizeEvalStringList(value: unknown, label: string): string[] {
  if (!isEvalArray(value)) {
    throw createEvalValidationError(`${label} must be an array of strings`);
  }

  const normalized = value.map((entry, index) => normalizeEvalString(entry, `${label}[${index}]`));
  return [...new Set(normalized)];
}

export function assertFiniteEvalNumber(
  value: unknown,
  label: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer && !Number.isInteger(value)) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  ) {
    const constraints = [
      options.integer ? "an integer" : "a finite number",
      options.min !== undefined ? `at least ${options.min}` : "",
      options.max !== undefined ? `at most ${options.max}` : "",
    ].filter(Boolean).join(" and ");
    throw createEvalValidationError(`${label} must be ${constraints}`);
  }
}

export function assertEvalTimerDuration(
  value: unknown,
  label: string,
  options: { min?: number } = {},
): asserts value is number {
  assertFiniteEvalNumber(value, label, {
    integer: true,
    min: options.min ?? 0,
    max: MAX_TIMER_DELAY_MS,
  });
}

export function normalizeEvalExamples(
  examples: readonly EvalExampleInput[],
  source: string,
): EvalExample[] {
  if (!isEvalArray(examples)) {
    throw createEvalValidationError(`${source} must be an array of eval examples`);
  }

  const seenIds = new Set<string>();

  return examples.map((example, index) => {
    if (!isEvalRecord(example)) {
      throw createEvalValidationError(`${source}[${index}] must be an object`);
    }

    const id = normalizeEvalString(example.id, `${source}[${index}] id`);

    if (seenIds.has(id)) {
      throw createEvalValidationError(`Duplicate eval example id "${id}" in ${source}`);
    }
    seenIds.add(id);

    if (!Object.hasOwn(example, "input")) {
      throw createEvalValidationError(`${source}[${index}] input is required`);
    }

    assertMetadata(example.metadata, `${source}[${index}]`);

    return {
      id,
      input: example.input,
      ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
      ...(example.metadata ? { metadata: { ...example.metadata } } : {}),
    };
  });
}
