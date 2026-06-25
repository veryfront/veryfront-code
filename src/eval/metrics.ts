import type {
  EvalMetric,
  EvalMetricFamily,
  EvalMetricResult,
  EvalMetricThreshold,
  EvalRecord,
  EvalSeverity,
  EvalToolCallCountOptions,
  EvalToolCallMatchOptions,
} from "./types.ts";
import {
  evaluateCalledTool,
  evaluateNotCalledTool,
  evaluateToolCallCount,
  isEvalToolFailed,
} from "./tool-behavior.ts";

type MetricEvaluator = (record: EvalRecord) => EvalMetricResult | Promise<EvalMetricResult>;

type JudgeRubricInput = {
  rubric: string;
  judge?: (input: {
    rubric: string;
    input: unknown;
    output: Record<string, unknown>;
    reference?: unknown;
    metadata: Record<string, unknown>;
  }) => Promise<{ score: number; pass?: boolean; explanation?: string }>;
};

function getOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.output === "string") return record.output;
  }
  return stableStringify(output);
}

function getOutputJson(output: unknown): unknown {
  if (output && typeof output === "object" && "json" in output) {
    return (output as { json: unknown }).json;
  }
  return output;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function withSeverity(
  metric: Omit<EvalMetric, "gate" | "soft" | "budget">,
  severity: EvalSeverity,
  threshold?: EvalMetricThreshold,
): EvalMetric {
  const base = { ...metric, severity, ...(threshold ? { threshold } : {}) };
  return {
    ...base,
    async evaluate(record, context) {
      const result = await metric.evaluate(record, context);
      const next = {
        ...result,
        name: metric.name,
        family: metric.family,
        severity,
      };
      if (!threshold || result.skipped || typeof next.score !== "number") {
        return next;
      }

      const minPass = threshold.min === undefined || next.score >= threshold.min;
      const maxPass = threshold.max === undefined || next.score <= threshold.max;
      const thresholdPass = minPass && maxPass;
      return {
        ...next,
        pass: next.pass === undefined ? thresholdPass : next.pass && thresholdPass,
      };
    },
    gate(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "gate", nextThreshold ?? threshold);
    },
    soft(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "soft", nextThreshold ?? threshold);
    },
    budget(nextThreshold?: EvalMetricThreshold) {
      return withSeverity(base, "budget", nextThreshold ?? threshold);
    },
  };
}

function createMetric(
  name: string,
  family: EvalMetricFamily,
  evaluator: MetricEvaluator,
  config?: Record<string, unknown>,
): EvalMetric {
  const metric = {
    name,
    family,
    severity: "gate" as const,
    ...(config ? { config } : {}),
    async evaluate(record: EvalRecord): Promise<EvalMetricResult> {
      const result = await evaluator(record);
      return {
        ...result,
        name,
        family,
        severity: "gate",
      };
    },
  };

  return withSeverity(metric, "gate");
}

function scoreResult(
  name: string,
  family: EvalMetricFamily,
  severity: EvalSeverity,
  pass: boolean,
  score = pass ? 1 : 0,
): EvalMetricResult {
  return { name, family, severity, score, pass };
}

/** Metric factories for deterministic answers, agent behavior, operations, and judges. */
export const metrics = {
  answer: {
    exactMatch(): EvalMetric {
      return createMetric("answer.exactMatch", "answer", (record) => {
        const pass = getOutputText(record.output) === getOutputText(record.reference);
        return scoreResult("answer.exactMatch", "answer", "gate", pass);
      });
    },

    contains(options: { text: string; caseSensitive?: boolean }): EvalMetric {
      return createMetric("answer.contains", "answer", (record) => {
        const actual = getOutputText(record.output);
        const expected = options.text;
        const pass = options.caseSensitive
          ? actual.includes(expected)
          : actual.toLowerCase().includes(expected.toLowerCase());
        return scoreResult("answer.contains", "answer", "gate", pass);
      }, options);
    },

    regex(options: { pattern: string; flags?: string }): EvalMetric {
      return createMetric("answer.regex", "answer", (record) => {
        const pattern = new RegExp(options.pattern, options.flags);
        return scoreResult(
          "answer.regex",
          "answer",
          "gate",
          pattern.test(getOutputText(record.output)),
        );
      }, options);
    },

    jsonMatch(options: { expected?: unknown }): EvalMetric {
      return createMetric("answer.jsonMatch", "answer", (record) => {
        const expected = Object.hasOwn(options, "expected") ? options.expected : record.reference;
        const actual = getOutputJson(record.output);
        const pass = stableStringify(actual) === stableStringify(expected);
        return scoreResult("answer.jsonMatch", "answer", "gate", pass);
      }, options as Record<string, unknown>);
    },
  },

  agent: {
    noFailedTools(): EvalMetric {
      return createMetric("agent.noFailedTools", "agent", (record) => {
        const failedTools = record.trace.toolCalls.filter(isEvalToolFailed).map((tool) =>
          tool.name
        );
        return {
          name: "agent.noFailedTools",
          family: "agent",
          severity: "gate",
          score: failedTools.length === 0 ? 1 : 0,
          pass: failedTools.length === 0,
          ...(failedTools.length > 0 ? { evidence: { failedTools } } : {}),
        };
      });
    },

    calledTool(name: string, options?: EvalToolCallMatchOptions): EvalMetric {
      return createMetric(
        "agent.calledTool",
        "agent",
        (record) => ({
          name: "agent.calledTool",
          family: "agent",
          severity: "gate",
          ...evaluateCalledTool(record, name, options),
        }),
        { tool: name, ...(options ?? {}) },
      );
    },

    notCalledTool(name: string): EvalMetric {
      return createMetric(
        "agent.notCalledTool",
        "agent",
        (record) => ({
          name: "agent.notCalledTool",
          family: "agent",
          severity: "gate",
          ...evaluateNotCalledTool(record, name),
        }),
        { tool: name },
      );
    },

    toolCallCount(name: string, options: EvalToolCallCountOptions): EvalMetric {
      return createMetric(
        "agent.toolCallCount",
        "agent",
        (record) => ({
          name: "agent.toolCallCount",
          family: "agent",
          severity: "gate",
          ...evaluateToolCallCount(record, name, options),
        }),
        { tool: name, ...options },
      );
    },
  },

  ops: {
    latency(options: { maxMs: number }): EvalMetric {
      return createMetric("ops.latency", "ops", (record) => {
        const pass = record.durationMs <= options.maxMs;
        return {
          name: "ops.latency",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { durationMs: record.durationMs, maxMs: options.maxMs },
        };
      }, options);
    },

    tokens(options: { maxTotal?: number; maxInput?: number; maxOutput?: number }): EvalMetric {
      return createMetric("ops.tokens", "ops", (record) => {
        const inputOk = options.maxInput === undefined ||
          (record.usage.inputTokens ?? 0) <= options.maxInput;
        const outputOk = options.maxOutput === undefined ||
          (record.usage.outputTokens ?? 0) <= options.maxOutput;
        const totalOk = options.maxTotal === undefined ||
          (record.usage.totalTokens ?? 0) <= options.maxTotal;
        const pass = inputOk && outputOk && totalOk;
        return {
          name: "ops.tokens",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { usage: record.usage, limits: options },
        };
      }, options as Record<string, unknown>);
    },

    cost(options: { maxUsd: number }): EvalMetric {
      return createMetric("ops.cost", "ops", (record) => {
        const costUsd = record.usage.costUsd ?? 0;
        const pass = costUsd <= options.maxUsd;
        return {
          name: "ops.cost",
          family: "ops",
          severity: "budget",
          score: pass ? 1 : 0,
          pass,
          evidence: { costUsd, maxUsd: options.maxUsd },
        };
      }, options);
    },
  },

  judge: {
    rubric(options: JudgeRubricInput): EvalMetric {
      return createMetric("judge.rubric", "judge", async (record) => {
        if (!options.judge) {
          return {
            name: "judge.rubric",
            family: "judge",
            severity: "gate",
            skipped: true,
            explanation: "No judge function was provided.",
          };
        }

        const output = record.output && typeof record.output === "object"
          ? record.output as Record<string, unknown>
          : { text: getOutputText(record.output) };
        const judged = await options.judge({
          rubric: options.rubric,
          input: record.input,
          output,
          reference: record.reference,
          metadata: record.metadata,
        });
        const min = 0;

        return {
          name: "judge.rubric",
          family: "judge",
          severity: "gate",
          score: judged.score,
          pass: judged.pass ?? judged.score > min,
          ...(judged.explanation ? { explanation: judged.explanation } : {}),
        };
      }, { rubric: options.rubric });
    },
  },
} as const;

export { getOutputText, stableStringify };
