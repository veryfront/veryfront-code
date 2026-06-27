import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EvalReport } from "veryfront/eval";
import { compareEvalModelReports, createEvalModelComparisonMarkdown } from "./model-comparison.ts";

function createReport(
  model: string,
  overrides: {
    runId?: string;
    passed?: number;
    failed?: number;
    totalTokens?: number;
    costUsd?: number;
    p95Ms?: number;
    groundednessScore?: number;
    measureGroundedness?: boolean;
    failedExamples?: string[];
  } = {},
): EvalReport {
  const measureGroundedness = overrides.measureGroundedness ?? true;
  const records = (overrides.failedExamples ?? []).map((exampleId) => ({
    id: `${exampleId}:1`,
    evalId: "eval:support",
    exampleId,
    repetition: 1,
    input: "question",
    output: { text: "answer" },
    metadata: {},
    trace: { events: [], toolCalls: [] },
    usage: {},
    durationMs: 100,
    completed: true,
    metrics: measureGroundedness
      ? [
        {
          name: "answer.groundedness",
          family: "answer" as const,
          severity: "gate" as const,
          score: overrides.groundednessScore ?? 1,
          pass: (overrides.groundednessScore ?? 1) >= 0.8,
        },
      ]
      : [],
  }));
  const passed = overrides.passed ?? 4;
  const failed = overrides.failed ?? 0;
  return {
    kind: "eval-report",
    runId: overrides.runId ?? `evalrun_${model.replaceAll("/", "_")}`,
    definitionId: "eval:support",
    targetKind: "agent",
    target: "agent:support",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    metadata: { model },
    summary: {
      records: passed + failed,
      passed,
      failed,
      passRate: passed / (passed + failed),
      metrics: measureGroundedness
        ? [
          {
            name: "answer.groundedness",
            family: "answer",
            severity: "gate",
            passed,
            failed,
            skipped: 0,
            passRate: failed === 0 ? 1 : passed / (passed + failed),
          },
        ]
        : [],
      duration: {
        totalMs: (passed + failed) * 100,
        minMs: 80,
        maxMs: overrides.p95Ms ?? 100,
        meanMs: 100,
        p50Ms: 95,
        p95Ms: overrides.p95Ms ?? 100,
      },
      usage: {
        totalTokens: overrides.totalTokens,
        costUsd: overrides.costUsd,
      },
      gateFailures: failed === 0 ? [] : [
        {
          recordId: `${overrides.failedExamples?.[0] ?? "q1"}:1`,
          exampleId: overrides.failedExamples?.[0] ?? "q1",
          repetition: 1,
          name: "answer.groundedness",
          family: "answer",
          severity: "gate",
        },
      ],
      failedExamples: (overrides.failedExamples ?? []).map((exampleId) => ({
        exampleId,
        records: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
        flaky: false,
      })),
    },
    records,
  };
}

describe("eval/model-comparison", () => {
  it("recommends promotion when the candidate preserves quality and has a cheaper signal", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6", { totalTokens: 10_000, costUsd: 1 }),
        createReport("moonshotai/kimi-k2.6", { totalTokens: 9_000, costUsd: 0.5 }),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(comparison.baselineModel, "anthropic/claude-opus-4-6");
    assertEquals(comparison.candidateModels, ["moonshotai/kimi-k2.6"]);
    assertEquals(comparison.recommendation, {
      decision: "promote-candidate",
      model: "moonshotai/kimi-k2.6",
      reasons: [
        "candidate has no quality regressions",
        "groundedness is at or above 0.8",
        "cost improved by 50%",
      ],
    });
  });

  it("keeps the baseline when a cheaper candidate introduces new failed examples", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6", { totalTokens: 10_000, costUsd: 1 }),
        createReport("moonshotai/kimi-k2.6", {
          passed: 3,
          failed: 1,
          totalTokens: 7_500,
          costUsd: 0.4,
          failedExamples: ["refund-escalation"],
        }),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(comparison.recommendation.decision, "keep-baseline");
    assertEquals(comparison.candidates[0]?.newFailedExamples, ["refund-escalation"]);
  });

  it("promotes cheaper candidates that pass gates even when soft metrics drop", () => {
    const baseline = createReport("anthropic/claude-opus-4-6", {
      passed: 3,
      failed: 1,
      totalTokens: 10_000,
      failedExamples: ["sso-login-after-release"],
    });
    baseline.summary.metrics.push({
      name: "knowledge.precisionAtK",
      family: "knowledge",
      severity: "soft",
      passed: 4,
      failed: 0,
      skipped: 0,
      passRate: 1,
    });

    const candidate = createReport("moonshotai/kimi-k2.6", {
      totalTokens: 6_000,
    });
    candidate.summary.metrics.push({
      name: "knowledge.precisionAtK",
      family: "knowledge",
      severity: "soft",
      passed: 3,
      failed: 1,
      skipped: 0,
      passRate: 0.75,
    });

    const comparison = compareEvalModelReports([baseline, candidate], {
      baselineModel: "anthropic/claude-opus-4-6",
    });

    assertEquals(comparison.candidates[0]?.decision, "promote-candidate");
    assertEquals(comparison.recommendation.decision, "promote-candidate");
  });

  it("promotes cheaper candidates when deterministic evals do not measure groundedness", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6", {
          measureGroundedness: false,
          totalTokens: 10_000,
          costUsd: 1,
        }),
        createReport("moonshotai/kimi-k2.6", {
          measureGroundedness: false,
          totalTokens: 9_000,
          costUsd: 0.5,
        }),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(comparison.recommendation, {
      decision: "promote-candidate",
      model: "moonshotai/kimi-k2.6",
      reasons: [
        "candidate has no quality regressions",
        "groundedness was not measured",
        "cost improved by 50%",
      ],
    });
  });

  it("asks for review when quality passes but no efficiency signal is measurable", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6"),
        createReport("moonshotai/kimi-k2.6"),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(comparison.recommendation.decision, "needs-review");
    assertEquals(comparison.recommendation.reasons, [
      "candidate has no quality regressions",
      "groundedness is at or above 0.8",
      "no cost, token, or latency improvement could be measured",
    ]);
  });

  it("renders a compact markdown report", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6", { totalTokens: 10_000, costUsd: 1 }),
        createReport("moonshotai/kimi-k2.6", { totalTokens: 9_000, costUsd: 0.5 }),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(
      createEvalModelComparisonMarkdown(comparison).includes(
        "| moonshotai/kimi-k2.6 | candidate |",
      ),
      true,
    );
  });
});
