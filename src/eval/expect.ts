import { getOutputText } from "./metrics.ts";
import {
  evaluateCalledTool,
  evaluateNotCalledTool,
  evaluateToolCallCount,
  isEvalToolFailed,
} from "./tool-behavior.ts";
import type {
  EvalDefinition,
  EvalExample,
  EvalExpect,
  EvalExpectation,
  EvalMetricResult,
  EvalMetricThreshold,
  EvalRecord,
  EvalSeverity,
} from "./types.ts";
import { createEvalValidationError } from "./validation.ts";

const MAX_EXPECTATION_TEXT_LENGTH = 16_384;
const MAX_EVAL_CHECK_RESULTS = 10_000;

function assertExpectationThreshold(threshold: EvalMetricThreshold | undefined): void {
  if (!threshold) return;
  if (
    (threshold.min !== undefined && !Number.isFinite(threshold.min)) ||
    (threshold.max !== undefined && !Number.isFinite(threshold.max)) ||
    (threshold.min !== undefined && threshold.max !== undefined && threshold.min > threshold.max)
  ) {
    throw createEvalValidationError("Expectation threshold must contain valid finite bounds");
  }
}

function createExpectation(
  checks: EvalMetricResult[],
  base: Omit<EvalMetricResult, "severity">,
): EvalExpectation {
  function record(severity: EvalSeverity, threshold?: EvalMetricThreshold): EvalMetricResult {
    assertExpectationThreshold(threshold);
    if (checks.length >= MAX_EVAL_CHECK_RESULTS) {
      throw createEvalValidationError(
        `Eval checks must not exceed ${MAX_EVAL_CHECK_RESULTS} results`,
      );
    }
    const normalizedThreshold = threshold ? { ...threshold } : undefined;
    const thresholdPass = !normalizedThreshold || typeof base.score !== "number" ||
      ((normalizedThreshold.min === undefined || base.score >= normalizedThreshold.min) &&
        (normalizedThreshold.max === undefined || base.score <= normalizedThreshold.max));
    const check = {
      ...base,
      severity,
      ...(base.pass === undefined ? { pass: thresholdPass } : { pass: base.pass && thresholdPass }),
      ...(normalizedThreshold
        ? { evidence: { ...(base.evidence ?? {}), threshold: normalizedThreshold } }
        : {}),
    };
    checks.push(check);
    return check;
  }

  return {
    gate: (threshold?: EvalMetricThreshold) => record("gate", threshold),
    soft: (threshold?: EvalMetricThreshold) => record("soft", threshold),
    budget: (threshold?: EvalMetricThreshold) => record("budget", threshold),
  };
}

export function createEvalExpect(record: EvalRecord, checks: EvalMetricResult[]): EvalExpect {
  return {
    completed() {
      return createExpectation(checks, {
        name: "expect.completed",
        family: "check",
        score: record.completed ? 1 : 0,
        pass: record.completed,
        ...(record.error ? { explanation: record.error } : {}),
      });
    },

    outputContains(text: string) {
      if (
        typeof text !== "string" || text.length === 0 || text.length > MAX_EXPECTATION_TEXT_LENGTH
      ) {
        throw createEvalValidationError("Expected output text must be a non-empty bounded string");
      }
      const output = getOutputText(record.output);
      const pass = output.includes(text);
      return createExpectation(checks, {
        name: "expect.outputContains",
        family: "check",
        score: pass ? 1 : 0,
        pass,
        evidence: { text },
      });
    },

    noFailedTools() {
      const failedTools = record.trace.toolCalls
        .filter(isEvalToolFailed)
        .map((tool) => tool.name);
      return createExpectation(checks, {
        name: "expect.noFailedTools",
        family: "check",
        score: failedTools.length === 0 ? 1 : 0,
        pass: failedTools.length === 0,
        ...(failedTools.length > 0 ? { evidence: { failedTools } } : {}),
      });
    },

    calledTool(name, options) {
      return createExpectation(checks, {
        name: "expect.calledTool",
        family: "check",
        ...evaluateCalledTool(record, name, options),
      });
    },

    notCalledTool(name) {
      return createExpectation(checks, {
        name: "expect.notCalledTool",
        family: "check",
        ...evaluateNotCalledTool(record, name),
      });
    },

    toolCallCount(name, options) {
      return createExpectation(checks, {
        name: "expect.toolCallCount",
        family: "check",
        ...evaluateToolCallCount(record, name, options),
      });
    },
  };
}

export function createEvalCheckContext(input: {
  definition: EvalDefinition;
  example: EvalExample;
  repetition: number;
  record: EvalRecord;
  checks: EvalMetricResult[];
}) {
  return {
    definition: input.definition,
    example: input.example,
    repetition: input.repetition,
    record: input.record,
    expect: createEvalExpect(input.record, input.checks),
  };
}
