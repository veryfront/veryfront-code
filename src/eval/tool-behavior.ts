import type {
  EvalMetricResult,
  EvalRecord,
  EvalToolCall,
  EvalToolCallCountOptions,
  EvalToolCallMatchOptions,
  EvalToolInputMatchMode,
} from "./types.ts";

type ToolBehaviorResult = Omit<EvalMetricResult, "name" | "family" | "severity">;

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
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
    return Object.entries(expected).every(([key, value]) => partialMatch(actual[key], value));
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
