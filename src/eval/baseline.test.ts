import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
      newFailedExamples: [],
      fixedExamples: ["q2"],
      regressed: false,
    });
  });
});
