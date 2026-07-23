import type {
  EvalMetricResult,
  EvalRecord,
  EvalToolCall,
  EvalToolCallCountOptions,
  EvalToolCallMatchOptions,
  EvalToolInputMatchMode,
} from "./types.ts";
import { canonicalJsonStringify } from "./canonical-json.ts";
import { createEvalValidationError } from "./validation.ts";

const MAX_TOOL_NAME_LENGTH = 16_384;
const MAX_TOOL_MATCH_NODES = 100_000;

function assertToolName(name: string): void {
  if (
    typeof name !== "string" || name.trim().length === 0 || name.length > MAX_TOOL_NAME_LENGTH
  ) {
    throw createEvalValidationError("Tool name must be a non-empty bounded string");
  }
}

function assertCountOptions(options: EvalToolCallCountOptions): void {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw createEvalValidationError("Tool call count options must be an object");
  }
  const values = [options.exact, options.min, options.max].filter((value) => value !== undefined);
  if (values.length === 0) {
    throw createEvalValidationError("Tool call count must configure exact, min, or max");
  }
  if (options.exact !== undefined && (options.min !== undefined || options.max !== undefined)) {
    throw createEvalValidationError("Tool call count exact cannot be combined with min or max");
  }
  if (
    values.some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw createEvalValidationError("Tool call counts must be non-negative integers");
  }
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) {
    throw createEvalValidationError("Tool call count min must not exceed max");
  }
}

type ToolBehaviorResult = Omit<EvalMetricResult, "name" | "family" | "severity">;

function stableStringify(value: unknown): string {
  return canonicalJsonStringify(value) ?? String(value);
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  try {
    return stableStringify(actual) === stableStringify(expected);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function partialMatch(
  actual: unknown,
  expected: unknown,
  depth = 0,
  state: { nodes: number; seen: WeakSet<object> } = { nodes: 0, seen: new WeakSet() },
): boolean {
  state.nodes += 1;
  if (state.nodes > MAX_TOOL_MATCH_NODES || depth > 100) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || state.seen.has(expected)) return false;
    state.seen.add(expected);
    try {
      return expected.every((entry, index) => partialMatch(actual[index], entry, depth + 1, state));
    } finally {
      state.seen.delete(expected);
    }
  }

  if (isRecord(expected)) {
    if (!isRecord(actual) || state.seen.has(expected)) return false;
    state.seen.add(expected);
    try {
      return Object.entries(expected).every(([key, value]) =>
        Object.hasOwn(actual, key) && partialMatch(actual[key], value, depth + 1, state)
      );
    } finally {
      state.seen.delete(expected);
    }
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

export function findEvalToolCalls(record: EvalRecord, name: string): EvalToolCall[] {
  assertToolName(name);
  return record.trace.toolCalls.filter((tool) => tool.name === name);
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
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw createEvalValidationError("Tool call match options must be an object");
  }
  if (options.match !== undefined && options.match !== "exact" && options.match !== "partial") {
    throw createEvalValidationError('Tool call match must be "exact" or "partial"');
  }
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
  assertCountOptions(options);
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
