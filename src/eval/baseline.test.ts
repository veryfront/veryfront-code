import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EvalReport } from "veryfront/eval";
import { compareEvalReports } from "./baseline.ts";

function createReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    kind: "eval-report",
    runId: "evalrun_current",
    definitionId: "eval:answers",
    targetKind: "agent",
    target: "agent:assistant",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    summary: {
      records: 2,
      passed: 2,
      failed: 0,
      passRate: 1,
      metrics: [
        {
          name: "answer.contains",
          family: "answer",
          severity: "gate",
          passed: 2,
          failed: 0,
          skipped: 0,
          passRate: 1,
        },
      ],
      failedExamples: [],
    },
    records: [],
    ...overrides,
  };
}

describe("eval/baseline", () => {
  it("compares a current report to a saved baseline", () => {
    const baseline = createReport({
      runId: "evalrun_baseline",
      summary: {
        records: 2,
        passed: 2,
        failed: 0,
        passRate: 1,
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            passed: 2,
            failed: 0,
            skipped: 0,
            passRate: 1,
          },
        ],
        failedExamples: [],
      },
    });
    const current = createReport({
      summary: {
        records: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            passed: 1,
            failed: 1,
            skipped: 0,
            passRate: 0.5,
          },
        ],
        failedExamples: [
          {
            exampleId: "q2",
            records: 1,
            passed: 0,
            failed: 1,
            passRate: 0,
            flaky: false,
          },
        ],
      },
    });

    assertEquals(compareEvalReports(current, baseline), {
      kind: "eval-report-comparison",
      currentRunId: "evalrun_current",
      baselineRunId: "evalrun_baseline",
      passRateDelta: -0.5,
      passedDelta: -1,
      failedDelta: 1,
      metricDeltas: [
        {
          name: "answer.contains",
          family: "answer",
          severity: "gate",
          baselinePassRate: 1,
          currentPassRate: 0.5,
          passRateDelta: -0.5,
          baselineFailed: 0,
          currentFailed: 1,
          failedDelta: 1,
          regressed: true,
        },
      ],
      budgetDeltas: [],
      newFailedExamples: ["q2"],
      fixedExamples: [],
      regressed: true,
    });
  });

  it("reports improvements without marking regressions", () => {
    const baseline = createReport({
      runId: "evalrun_baseline",
      summary: {
        records: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        metrics: [],
        failedExamples: [
          {
            exampleId: "q2",
            records: 1,
            passed: 0,
            failed: 1,
            passRate: 0,
            flaky: false,
          },
        ],
      },
    });
    const current = createReport();

    assertEquals(compareEvalReports(current, baseline), {
      kind: "eval-report-comparison",
      currentRunId: "evalrun_current",
      baselineRunId: "evalrun_baseline",
      passRateDelta: 0.5,
      passedDelta: 1,
      failedDelta: -1,
      metricDeltas: [
        {
          name: "answer.contains",
          family: "answer",
          severity: "gate",
          baselinePassRate: null,
          currentPassRate: 1,
          passRateDelta: null,
          baselineFailed: null,
          currentFailed: 0,
          failedDelta: null,
          regressed: false,
        },
      ],
      budgetDeltas: [],
      newFailedExamples: [],
      fixedExamples: ["q2"],
      regressed: false,
    });
  });

  it("flags a gate metric that vanished from the current run", () => {
    const baseline = createReport({ runId: "evalrun_baseline" });
    const current = createReport({
      summary: {
        records: 2,
        passed: 2,
        failed: 0,
        passRate: 1,
        metrics: [],
        failedExamples: [],
      },
    });

    const comparison = compareEvalReports(current, baseline);

    assertEquals(
      comparison.metricDeltas[0]?.currentPassRate,
      null,
      "a vanished metric reports no current pass rate",
    );
    assertEquals(
      comparison.metricDeltas[0]?.baselinePassRate,
      1,
      "a vanished metric keeps the baseline pass rate",
    );
    assertEquals(
      comparison.metricDeltas[0]?.regressed,
      true,
      "a metric present in the baseline but absent now is a regression",
    );
    assertEquals(
      comparison.regressed,
      true,
      "a vanished gate metric regresses the comparison",
    );
  });

  it("applies pass-rate regression thresholds without hiding reported deltas", () => {
    const baseline = createReport({
      runId: "evalrun_baseline",
      summary: {
        records: 100,
        passed: 100,
        failed: 0,
        passRate: 1,
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            passed: 100,
            failed: 0,
            skipped: 0,
            passRate: 1,
          },
        ],
        failedExamples: [],
      },
    });
    const current = createReport({
      summary: {
        records: 100,
        passed: 99,
        failed: 1,
        passRate: 0.99,
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            passed: 99,
            failed: 1,
            skipped: 0,
            passRate: 0.99,
          },
        ],
        failedExamples: [],
      },
    });

    assertEquals(compareEvalReports(current, baseline).regressed, true);
    assertEquals(
      compareEvalReports(current, baseline, {
        passRateDropThreshold: 0.02,
        metricPassRateDropThreshold: 0.02,
        failedDeltaThreshold: 1,
      }).regressed,
      false,
    );
  });

  it("reports usage and latency budget deltas and gates them only when thresholds are configured", () => {
    const baseline = createReport({
      runId: "evalrun_baseline",
      summary: {
        records: 2,
        passed: 2,
        failed: 0,
        passRate: 1,
        metrics: [],
        failedExamples: [],
        usage: {
          totalTokens: 1000,
          costUsd: 0.1,
          veryfrontChargeUsd: 0.05,
          veryfrontBilledUsd: 0.2,
          costCredits: 1,
        },
        duration: {
          totalMs: 2000,
          minMs: 800,
          maxMs: 1200,
          meanMs: 1000,
          p50Ms: 950,
          p95Ms: 1100,
        },
      },
    });
    const current = createReport({
      summary: {
        records: 2,
        passed: 2,
        failed: 0,
        passRate: 1,
        metrics: [],
        failedExamples: [],
        usage: {
          totalTokens: 1200,
          costUsd: 0.11,
          veryfrontChargeUsd: 0.07,
          veryfrontBilledUsd: 0.21,
          costCredits: 1.1,
        },
        duration: {
          totalMs: 2400,
          minMs: 900,
          maxMs: 1500,
          meanMs: 1200,
          p50Ms: 1000,
          p95Ms: 1400,
        },
      },
    });

    const comparison = compareEvalReports(current, baseline);
    assertEquals(comparison.regressed, false);
    assertEquals(comparison.budgetDeltas, [
      {
        name: "totalTokens",
        family: "usage",
        baselineValue: 1000,
        currentValue: 1200,
        delta: 200,
        percentDelta: 0.2,
        threshold: null,
        regressed: false,
      },
      {
        name: "costUsd",
        family: "usage",
        baselineValue: 0.1,
        currentValue: 0.11,
        delta: 0.009999999999999995,
        percentDelta: 0.09999999999999995,
        threshold: null,
        regressed: false,
      },
      {
        name: "veryfrontChargeUsd",
        family: "usage",
        baselineValue: 0.05,
        currentValue: 0.07,
        delta: 0.020000000000000004,
        percentDelta: 0.4000000000000001,
        threshold: null,
        regressed: false,
      },
      {
        name: "veryfrontBilledUsd",
        family: "usage",
        baselineValue: 0.2,
        currentValue: 0.21,
        delta: 0.009999999999999981,
        percentDelta: 0.049999999999999906,
        threshold: null,
        regressed: false,
      },
      {
        name: "costCredits",
        family: "usage",
        baselineValue: 1,
        currentValue: 1.1,
        delta: 0.10000000000000009,
        percentDelta: 0.10000000000000009,
        threshold: null,
        regressed: false,
      },
      {
        name: "p95Ms",
        family: "latency",
        baselineValue: 1100,
        currentValue: 1400,
        delta: 300,
        percentDelta: 0.2727272727272727,
        threshold: null,
        regressed: false,
      },
    ]);

    const gated = compareEvalReports(current, baseline, {
      usageIncreaseThreshold: 0.15,
      latencyIncreaseThreshold: 0.2,
    });
    assertEquals(gated.regressed, true);
    assertEquals(
      gated.budgetDeltas.map((delta) => [delta.name, delta.regressed]),
      [
        ["totalTokens", true],
        ["costUsd", false],
        ["veryfrontChargeUsd", true],
        ["veryfrontBilledUsd", false],
        ["costCredits", false],
        ["p95Ms", true],
      ],
      "billing-charge budgets are reported and gated by name",
    );
  });

  it("rejects mismatched baselines and invalid regression policies", () => {
    const current = createReport();
    const wrongEval = createReport({ definitionId: "eval:other" });

    assertThrows(
      () => compareEvalReports(current, wrongEval),
      Error,
      "identity mismatch",
      "a different definition id is an identity mismatch",
    );
    assertThrows(
      () => compareEvalReports(current, createReport({ targetKind: "tool" })),
      Error,
      "identity mismatch",
      "a different target kind is an identity mismatch",
    );
    assertThrows(
      () => compareEvalReports(current, createReport({ target: "agent:other" })),
      Error,
      "identity mismatch",
      "a different target is an identity mismatch",
    );
    assertThrows(
      () => compareEvalReports(current, current, { passRateDropThreshold: Number.NaN }),
      Error,
      "finite",
    );
    assertThrows(
      () => compareEvalReports(current, current, { failedDeltaThreshold: -1 }),
      Error,
      "at least 0",
    );
  });
});
