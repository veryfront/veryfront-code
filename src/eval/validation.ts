import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { EvalExample, EvalExampleInput } from "./types.ts";

export function createEvalValidationError(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

export function isEvalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function normalizeEvalStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
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

export function normalizeEvalExamples(
  examples: readonly EvalExampleInput[],
  source: string,
): EvalExample[] {
  if (!Array.isArray(examples)) {
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
