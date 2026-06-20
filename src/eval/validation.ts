import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { EvalExample, EvalExampleInput } from "./types.ts";

export function createEvalValidationError(message: string): Error {
  return INVALID_ARGUMENT.create({ message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === undefined || isRecord(value)) return;
  throw createEvalValidationError(`${label} metadata must be an object when provided`);
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
    if (!isRecord(example)) {
      throw createEvalValidationError(`${source}[${index}] must be an object`);
    }

    const id = example.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw createEvalValidationError(`${source}[${index}] id must be a non-empty string`);
    }

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
      ...(example.metadata ? { metadata: example.metadata } : {}),
    };
  });
}
