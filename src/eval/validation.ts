import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { EvalExample, EvalExampleInput } from "./types.ts";

export const MAX_EVAL_EXAMPLES = 100_000;
export const MAX_EVAL_EXAMPLE_ID_LENGTH = 4_096;
const MAX_EVAL_PUBLIC_ERROR_LENGTH = 4_096;

function replaceAsciiControlRuns(value: string): string {
  let output = "";
  let replacingControlRun = false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isControl = code <= 0x1f || code === 0x7f;
    if (isControl) {
      if (!replacingControlRun) output += " ";
      replacingControlRun = true;
      continue;
    }
    output += character;
    replacingControlRun = false;
  }
  return output;
}

/** Format an error for reports and logs without exposing common secret forms. */
export function formatEvalPublicError(error: unknown): string {
  const original = error instanceof Error ? error.message : String(error);
  const withoutCredentials = original.replace(
    /\b(https?:\/\/)([^\s/@]+)@/gi,
    "$1<REDACTED>@",
  );
  const withoutBearer = withoutCredentials.replace(
    /\bBearer\s+[^\s,;]+/gi,
    "Bearer <REDACTED>",
  );
  const withoutNamedSecrets = withoutBearer.replace(
    /\b(api[_-]?key|token|secret|password|authorization)\s*([:=])\s*([^\s,;]+)/gi,
    "$1$2<REDACTED>",
  );
  return replaceAsciiControlRuns(withoutNamedSecrets)
    .trim()
    .slice(0, MAX_EVAL_PUBLIC_ERROR_LENGTH) || "Eval operation failed.";
}

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
  if (examples.length > MAX_EVAL_EXAMPLES) {
    throw createEvalValidationError(
      `${source} must not contain more than ${MAX_EVAL_EXAMPLES} examples`,
    );
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
    if (id.length > MAX_EVAL_EXAMPLE_ID_LENGTH) {
      throw createEvalValidationError(
        `${source}[${index}] id must not exceed ${MAX_EVAL_EXAMPLE_ID_LENGTH} characters`,
      );
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
