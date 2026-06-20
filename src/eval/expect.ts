import { getOutputText } from "./metrics.ts";
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

function createExpectation(
  checks: EvalMetricResult[],
  base: Omit<EvalMetricResult, "severity">,
): EvalExpectation {
  function record(severity: EvalSeverity, threshold?: EvalMetricThreshold): EvalMetricResult {
    const check = {
      ...base,
      severity,
      ...(threshold ? { evidence: { ...(base.evidence ?? {}), threshold } } : {}),
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
        .filter((tool) => tool.status === "error" || typeof tool.error === "string")
        .map((tool) => tool.name);
      return createExpectation(checks, {
        name: "expect.noFailedTools",
        family: "check",
        score: failedTools.length === 0 ? 1 : 0,
        pass: failedTools.length === 0,
        ...(failedTools.length > 0 ? { evidence: { failedTools } } : {}),
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
