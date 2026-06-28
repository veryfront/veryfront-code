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
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    usageCaptureStatus?: "complete" | "partial" | "missing";
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
        inputTokens: overrides.inputTokens,
        outputTokens: overrides.outputTokens,
        totalTokens: overrides.totalTokens,
        billableInputTokens: overrides.billableInputTokens,
        billableOutputTokens: overrides.billableOutputTokens,
        costUsd: overrides.costUsd,
        providerInputCostUsd: overrides.providerInputCostUsd,
        providerOutputCostUsd: overrides.providerOutputCostUsd,
        providerCostUsd: overrides.providerCostUsd,
        veryfrontInputChargeUsd: overrides.veryfrontInputChargeUsd,
        veryfrontOutputChargeUsd: overrides.veryfrontOutputChargeUsd,
        veryfrontChargeUsd: overrides.veryfrontChargeUsd,
        veryfrontBilledUsd: overrides.veryfrontBilledUsd,
        costCredits: overrides.costCredits,
        costSource: overrides.costSource,
        usageCaptureStatus: overrides.usageCaptureStatus,
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

  it("uses billed Veryfront cost before metered gateway charge for cost decisions", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-sonnet-4-6", {
          veryfrontChargeUsd: 0.14,
          veryfrontBilledUsd: 0.4,
          costCredits: 4,
          costSource: "gateway",
        }),
        createReport("moonshotai/kimi-k2.6", {
          veryfrontChargeUsd: 0.08,
          veryfrontBilledUsd: 1.5,
          costCredits: 15,
          costSource: "gateway",
        }),
      ],
      { baselineModel: "anthropic/claude-sonnet-4-6" },
    );

    assertEquals(comparison.candidates[0]?.decision, "needs-review");
    assertEquals(comparison.candidates[0]?.costImprovementPct, -2.75);
    assertEquals(comparison.models[0]?.veryfrontBilledUsd, 0.4);
    assertEquals(comparison.models[1]?.veryfrontBilledUsd, 1.5);
  });

  it("uses metered gateway cost before credits when billed USD is omitted", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-sonnet-4-6", {
          veryfrontChargeUsd: 0.14,
          costCredits: 4,
          costSource: "gateway",
        }),
        createReport("moonshotai/kimi-k2.6", {
          veryfrontChargeUsd: 0.08,
          costCredits: 16,
          costSource: "gateway",
        }),
      ],
      { baselineModel: "anthropic/claude-sonnet-4-6" },
    );

    assertEquals(comparison.candidates[0]?.decision, "promote-candidate");
    assertEquals(comparison.candidates[0]?.costImprovementPct, 0.4285714285714286);
    assertEquals(comparison.models[0]?.veryfrontBilledUsd, undefined);
    assertEquals(comparison.models[1]?.veryfrontBilledUsd, undefined);
    assertEquals(
      comparison.candidates[0]?.reasons.includes("Veryfront metered cost improved by 43%"),
      true,
    );
  });

  it("uses gateway credits for comparison only when USD costs are omitted", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-sonnet-4-6", {
          costCredits: 4,
          costSource: "gateway",
        }),
        createReport("moonshotai/kimi-k2.6", {
          costCredits: 16,
          costSource: "gateway",
        }),
      ],
      { baselineModel: "anthropic/claude-sonnet-4-6" },
    );

    assertEquals(comparison.candidates[0]?.decision, "needs-review");
    assertEquals(
      comparison.candidates[0]?.reasons.includes("Veryfront credits regressed by 300%"),
      true,
    );
  });

  it("does not promote token savings when billed Veryfront cost regresses", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-sonnet-4-6", {
          totalTokens: 10_000,
          veryfrontBilledUsd: 0.4,
          costCredits: 4,
          costSource: "gateway",
        }),
        createReport("moonshotai/kimi-k2.6", {
          totalTokens: 6_000,
          veryfrontBilledUsd: 1.6,
          costCredits: 16,
          costSource: "gateway",
        }),
      ],
      { baselineModel: "anthropic/claude-sonnet-4-6" },
    );

    assertEquals(comparison.candidates[0]?.decision, "needs-review");
    assertEquals(comparison.recommendation.decision, "needs-review");
    assertEquals(
      comparison.candidates[0]?.reasons.includes("Veryfront billed cost regressed by 300%"),
      true,
    );
  });

  it("keeps the baseline when a candidate violates a configured latency constraint", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("openai/gpt-5.2", { totalTokens: 10_000, p95Ms: 10_000 }),
        createReport("moonshotai/kimi-k2.6", { totalTokens: 7_000, p95Ms: 25_000 }),
      ],
      {
        baselineModel: "openai/gpt-5.2",
        constraints: {
          p95Ms: { maxRegressionPct: 0.5 },
        },
      },
    );

    assertEquals(comparison.candidates[0]?.decision, "keep-baseline");
    assertEquals(comparison.candidates[0]?.constraintFailures, [
      "p95Ms regressed by 150%, above the allowed 50%",
    ]);
    assertEquals(comparison.recommendation.decision, "keep-baseline");
  });

  it("keeps the baseline when weighted objectives favor latency over token reduction", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("openai/gpt-5.2", { totalTokens: 10_000, p95Ms: 10_000 }),
        createReport("moonshotai/kimi-k2.6", { totalTokens: 7_000, p95Ms: 15_000 }),
      ],
      {
        baselineModel: "openai/gpt-5.2",
        objectives: {
          totalTokens: { weight: 0.3, direction: "minimize" },
          p95Ms: { weight: 0.7, direction: "minimize" },
        },
      },
    );

    assertEquals(comparison.candidates[0]?.decision, "keep-baseline");
    assertEquals(comparison.candidates[0]?.objectiveScore, -0.26);
    assertEquals(comparison.recommendation.decision, "keep-baseline");
  });

  it("promotes a candidate when weighted objectives favor token reduction over latency", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("openai/gpt-5.2", { totalTokens: 10_000, p95Ms: 10_000 }),
        createReport("moonshotai/kimi-k2.6", { totalTokens: 7_000, p95Ms: 15_000 }),
      ],
      {
        baselineModel: "openai/gpt-5.2",
        objectives: {
          totalTokens: { weight: 0.8, direction: "minimize" },
          p95Ms: { weight: 0.2, direction: "minimize" },
        },
      },
    );

    assertEquals(comparison.candidates[0]?.decision, "promote-candidate");
    assertEquals(comparison.candidates[0]?.objectiveScore, 0.14);
    assertEquals(comparison.recommendation.decision, "promote-candidate");
  });

  it("keeps objective scores finite when the baseline metric is zero", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("openai/gpt-5.2", { passed: 0, failed: 4 }),
        createReport("moonshotai/kimi-k2.6", { passed: 4, failed: 0 }),
      ],
      {
        baselineModel: "openai/gpt-5.2",
        objectives: {
          passRate: { weight: 1, direction: "maximize" },
        },
      },
    );

    assertEquals(comparison.candidates[0]?.objectiveScore, 1);
    assertEquals(
      JSON.parse(JSON.stringify(comparison)).candidates[0].objectiveScore,
      1,
    );
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
        createReport("anthropic/claude-opus-4-6", {
          totalTokens: 10_000,
          costUsd: 1,
          p95Ms: 10_000,
        }),
        createReport("moonshotai/kimi-k2.6", {
          totalTokens: 9_000,
          costUsd: 0.5,
          p95Ms: 25_000,
        }),
      ],
      {
        baselineModel: "anthropic/claude-opus-4-6",
        constraints: {
          p95Ms: { maxRegressionPct: 0.5 },
        },
      },
    );
    const markdown = createEvalModelComparisonMarkdown(comparison);

    assertEquals(
      markdown.includes("| moonshotai/kimi-k2.6 | candidate |"),
      true,
    );
    assertEquals(markdown.includes("## Candidates"), true);
    assertEquals(
      markdown.includes("p95Ms regressed by 150%, above the allowed 50%"),
      true,
    );
  });

  it("renders unmeasured cost cells explicitly", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("openai/gpt-5.2"),
        createReport("moonshotai/kimi-k2.6"),
      ],
      { baselineModel: "openai/gpt-5.2" },
    );

    const markdown = createEvalModelComparisonMarkdown(comparison);

    assertEquals(
      markdown.includes("| not measured | not measured | - | - |"),
      true,
    );
  });

  it("derives billed gateway cost for comparison and shows token/cost breakdowns", () => {
    const comparison = compareEvalModelReports(
      [
        createReport("anthropic/claude-opus-4-6", {
          inputTokens: 8_000,
          outputTokens: 2_000,
          totalTokens: 10_000,
          billableInputTokens: 8_000,
          billableOutputTokens: 2_000,
          providerInputCostUsd: 0.3,
          providerOutputCostUsd: 0.1,
          providerCostUsd: 0.4,
          veryfrontInputChargeUsd: 0.75,
          veryfrontOutputChargeUsd: 0.25,
          veryfrontChargeUsd: 1,
          veryfrontBilledUsd: 1,
          costCredits: 10,
          costSource: "gateway",
          usageCaptureStatus: "complete",
        }),
        createReport("moonshotai/kimi-k2.6", {
          inputTokens: 7_000,
          outputTokens: 2_000,
          totalTokens: 9_000,
          billableInputTokens: 7_000,
          billableOutputTokens: 2_000,
          providerInputCostUsd: 0.12,
          providerOutputCostUsd: 0.08,
          providerCostUsd: 0.2,
          veryfrontInputChargeUsd: 0.3,
          veryfrontOutputChargeUsd: 0.2,
          veryfrontChargeUsd: 0.5,
          veryfrontBilledUsd: 0.5,
          costCredits: 5,
          costSource: "gateway",
          usageCaptureStatus: "complete",
        }),
      ],
      { baselineModel: "anthropic/claude-opus-4-6" },
    );

    assertEquals(comparison.recommendation, {
      decision: "promote-candidate",
      model: "moonshotai/kimi-k2.6",
      reasons: [
        "candidate has no quality regressions",
        "groundedness is at or above 0.8",
        "Veryfront billed cost improved by 50%",
      ],
    });

    const markdown = createEvalModelComparisonMarkdown(comparison);
    assertEquals(
      markdown.includes(
        "| Model | Role | Passed | Failed | Pass rate | Groundedness | Input tok | Output tok | Total tok | Billable in | Billable out | Provider in USD | Provider out USD | Provider USD | Metered in USD | Metered out USD | Metered USD | Billed USD | Credits | Cost source | p95 ms |",
      ),
      true,
    );
    assertEquals(markdown.includes("| moonshotai/kimi-k2.6 | candidate |"), true);
    assertEquals(
      markdown.includes(
        "| 7000 | 2000 | 9000 | 7000 | 2000 | 0.12 | 0.08 | 0.20 | 0.30 | 0.20 | 0.50 | 0.50 | 5.00 | gateway |",
      ),
      true,
    );
  });
});
