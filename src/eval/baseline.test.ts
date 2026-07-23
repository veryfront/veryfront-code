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
    assertEquals(gated.budgetDeltas.map((delta) => delta.regressed), [true, false, false, true]);
  });

  it("rejects negative and non-finite regression thresholds", () => {
    const current = createReport({ runId: "current" });
    const baseline = createReport({ runId: "baseline" });
    for (
      const policy of [
        { passRateDropThreshold: -1 },
        { metricPassRateDropThreshold: Number.NaN },
        { failedDeltaThreshold: -1 },
        { usageIncreaseThreshold: Number.POSITIVE_INFINITY },
        { latencyIncreaseThreshold: -0.1 },
      ]
    ) {
      assertThrows(() => compareEvalReports(current, baseline, policy), Error);
    }
  });
});
