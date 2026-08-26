import type {
  EvalMetricResult,
  EvalRecord,
  EvalToolCall,
  EvalToolCallCountOptions,
  EvalToolCallMatchOptions,
  EvalToolInputMatchMode,
} from "./types.ts";
import {
  assertFiniteEvalNumber,
  createEvalValidationError,
  isEvalRecord,
  normalizeEvalString,
} from "./validation.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

type ToolBehaviorResult = Omit<EvalMetricResult, "name" | "family" | "severity">;

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;

  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort(compareStrings)) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  return stableStringify(actual) === stableStringify(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function partialMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      expected.every((entry, index) => partialMatch(actual[index], entry));
  }

  if (isRecord(expected)) {
    if (!isRecord(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      Object.hasOwn(actual, key) && partialMatch(actual[key], value)
    );
  }

  return valuesEqual(actual, expected);
}

function matchesInput(
  actual: unknown,
  expected: unknown,
  mode: EvalToolInputMatchMode,
): boolean {
  return mode === "exact" ? valuesEqual(actual, expected) : partialMatch(actual, expected);
}

function hasExpectedInput(options: EvalToolCallMatchOptions): boolean {
  return Object.hasOwn(options, "input");
}

function expectedCount(options: EvalToolCallCountOptions): Record<string, number> {
  return {
    ...(options.exact !== undefined ? { exact: options.exact } : {}),
    ...(options.min !== undefined ? { min: options.min } : {}),
    ...(options.max !== undefined ? { max: options.max } : {}),
  };
}

function countPasses(count: number, options: EvalToolCallCountOptions): boolean {
  if (options.exact !== undefined) return count === options.exact;
  const minPass = options.min === undefined || count >= options.min;
  const maxPass = options.max === undefined || count <= options.max;
  return minPass && maxPass;
}

export function validateEvalToolCallMatchOptions(options: EvalToolCallMatchOptions): void {
  if (!isEvalRecord(options)) {
    throw createEvalValidationError("Eval tool call match options must be an object");
  }
  if (options.match !== undefined && options.match !== "exact" && options.match !== "partial") {
    throw createEvalValidationError('Eval tool input match must be "exact" or "partial"');
  }
}

export function validateEvalToolCallCountOptions(options: EvalToolCallCountOptions): void {
  const exact = options?.exact;
  const min = options?.min;
  const max = options?.max;
  if (!isEvalRecord(options)) {
    throw createEvalValidationError("Eval tool call count options must be an object");
  }
  const entries = [
    ["exact", exact],
    ["min", min],
    ["max", max],
  ] as const;
  for (const [key, value] of entries) {
    if (value !== undefined) {
      assertFiniteEvalNumber(value, `Eval tool call count ${key}`, { integer: true, min: 0 });
    }
  }
  if (exact === undefined && min === undefined && max === undefined) {
    throw createEvalValidationError(
      "Eval tool call count requires exact, min, or max",
    );
  }
  if (exact !== undefined && (min !== undefined || max !== undefined)) {
    throw createEvalValidationError(
      "Eval tool call count exact cannot be combined with min or max",
    );
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw createEvalValidationError("Eval tool call count min cannot exceed max");
  }
}

export function findEvalToolCalls(record: EvalRecord, name: string): EvalToolCall[] {
  const normalizedName = normalizeEvalString(name, "Eval tool name");
  return record.trace.toolCalls.filter((tool) => tool.name === normalizedName);
}

export function isEvalToolFailed(toolCall: { status?: string; error?: string }): boolean {
  return toolCall.status === "error" || toolCall.status === "denied" ||
    typeof toolCall.error === "string";
}

export function evaluateCalledTool(
  record: EvalRecord,
  name: string,
  options: EvalToolCallMatchOptions = {},
): ToolBehaviorResult {
  validateEvalToolCallMatchOptions(options);
  const calls = findEvalToolCalls(record, name);
  const expectedInputProvided = hasExpectedInput(options);
  const match = options.match ?? "partial";
  const inputMatched = !expectedInputProvided ||
    calls.some((call) => matchesInput(call.input, options.input, match));
  const pass = calls.length > 0 && inputMatched;
  const evidence: Record<string, unknown> = {
    tool: name,
    calls: calls.length,
  };

  if (expectedInputProvided) {
    evidence.expectedInput = options.input;
    evidence.match = match;
    if (!inputMatched) evidence.actualInputs = calls.map((call) => call.input);
  }

  return {
    score: pass ? 1 : 0,
    pass,
    evidence,
  };
}

export function evaluateNotCalledTool(record: EvalRecord, name: string): ToolBehaviorResult {
  const calls = findEvalToolCalls(record, name);
  const pass = calls.length === 0;
  return {
    score: pass ? 1 : 0,
    pass,
    evidence: { tool: name, calls: calls.length },
  };
}

export function evaluateToolCallCount(
  record: EvalRecord,
  name: string,
  options: EvalToolCallCountOptions,
): ToolBehaviorResult {
  validateEvalToolCallCountOptions(options);
  const calls = findEvalToolCalls(record, name);
  const pass = countPasses(calls.length, options);
  return {
    score: pass ? 1 : 0,
    pass,
    evidence: {
      tool: name,
      calls: calls.length,
      expected: expectedCount(options),
    },
  };
}
