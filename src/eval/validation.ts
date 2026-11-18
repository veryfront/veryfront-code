import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import type { EvalExample, EvalExampleInput } from "./types.ts";

const ArrayIsArray = Array.isArray;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const jsonByteEncoder = new TextEncoder();

/**
 * The forwarded props budget of a hosted run, in bytes of JSON. Request
 * validation and durable run admission both reject a larger envelope.
 */
export const MAX_EVAL_FORWARDED_PROPS_BYTES = 196_608;

/**
 * The size allowed for an eval `environmentContext`, in bytes of JSON. It
 * travels in the forwarded props, so the cap leaves 64 KB of that budget for
 * the request metadata and the prompt a durable run forwards beside it.
 */
export const MAX_EVAL_ENVIRONMENT_CONTEXT_BYTES = 131_072;

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

/**
 * Validate an optional `environmentContext`: the host facts an agent eval sends
 * as `<environment_context>`, the way Studio does. Blank text is rejected
 * rather than dropped, so a typo cannot silently run without the context.
 */
export function normalizeEvalEnvironmentContext(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw createEvalValidationError(`${label} environmentContext must be a non-empty string`);
  }
  if (getEvalJsonByteLength(value) > MAX_EVAL_ENVIRONMENT_CONTEXT_BYTES) {
    throw createEvalValidationError(
      `${label} environmentContext must be at most ${MAX_EVAL_ENVIRONMENT_CONTEXT_BYTES} bytes as JSON`,
    );
  }
  return value;
}

/**
 * Read `environmentContext` as an own data property. Project code shares the
 * realm and can extend Object.prototype, so an inherited value is not the
 * eval's or the example's.
 */
export function readOwnEvalEnvironmentContext(value: object): unknown {
  const descriptor = ObjectGetOwnPropertyDescriptor(value, "environmentContext");
  return descriptor && ObjectHasOwn(descriptor, "value") ? descriptor.value : undefined;
}

/**
 * The context an eval case runs with: the example's own value replaces the
 * eval's own value.
 */
export function resolveEvalCaseEnvironmentContext(
  example: object,
  definition: object,
): string | undefined {
  const value = readOwnEvalEnvironmentContext(example) ??
    readOwnEvalEnvironmentContext(definition);
  return typeof value === "string" ? value : undefined;
}

/**
 * The UTF-8 size of a value as JSON, the form in which it crosses a request.
 * A value that cannot be serialized counts as over any budget.
 */
export function getEvalJsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : jsonByteEncoder.encode(json).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
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

export function isEvalArray(value: unknown): value is unknown[] {
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

    if (
      example.expectedOutcome !== undefined && example.expectedOutcome !== "success" &&
      example.expectedOutcome !== "error"
    ) {
      throw createEvalValidationError(
        `${source}[${index}] expectedOutcome must be success or error`,
      );
    }

    assertMetadata(example.metadata, `${source}[${index}]`);
    const environmentContext = normalizeEvalEnvironmentContext(
      readOwnEvalEnvironmentContext(example),
      `${source}[${index}]`,
    );

    return {
      id,
      input: example.input,
      ...(example.expectedOutcome ? { expectedOutcome: example.expectedOutcome } : {}),
      ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
      ...(example.metadata ? { metadata: { ...example.metadata } } : {}),
      ...(environmentContext === undefined ? {} : { environmentContext }),
    };
  });
}
