import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { EvalRecord } from "veryfront/eval";
import { summarizeEvalRecords } from "./report.ts";

function createRecord(overrides: Partial<EvalRecord> = {}): EvalRecord {
  return {
    id: "q1:1",
    evalId: "eval:answers",
    exampleId: "q1",
    repetition: 1,
    input: "Capital of France?",
    output: { text: "Paris" },
    reference: "Paris",
    metadata: {},
    trace: { events: [], toolCalls: [] },
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      costUsd: 0.001,
    },
    durationMs: 100,
    completed: true,
    metrics: [
      {
        name: "answer.contains",
        family: "answer",
        severity: "gate",
        score: 1,
        pass: true,
      },
    ],
    checks: [],
    ...overrides,
  };
}

describe("eval/report", () => {
  it("summarizes duration, usage, failures, and flaky examples", () => {
    const summary = summarizeEvalRecords([
      createRecord({
        id: "q1:1",
        exampleId: "q1",
        repetition: 1,
        durationMs: 100,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          billableInputTokens: 10,
          billableOutputTokens: 7,
          costUsd: 0.001,
          providerInputCostUsd: 0.0004,
          providerOutputCostUsd: 0.0006,
          providerCostUsd: 0.001,
          veryfrontInputChargeUsd: 0.001,
          veryfrontOutputChargeUsd: 0.0015,
          veryfrontChargeUsd: 0.0025,
          veryfrontBilledUsd: 0.1,
          costCredits: 1,
          costSource: "gateway",
          billingMode: "deferred",
          cacheReadInputTokens: 2,
          cachedInputTokens: 2,
          reasoningTokens: 2,
          usageCaptureStatus: "complete",
        },
      }),
      createRecord({
        id: "q1:2",
        exampleId: "q1",
        repetition: 2,
        output: { text: "Lyon" },
        durationMs: 300,
        usage: {
          inputTokens: 12,
          outputTokens: 6,
          totalTokens: 18,
          billableInputTokens: 12,
          billableOutputTokens: 9,
          costUsd: 0.002,
          providerInputCostUsd: 0.0008,
          providerOutputCostUsd: 0.0012,
          providerCostUsd: 0.002,
          veryfrontInputChargeUsd: 0.002,
          veryfrontOutputChargeUsd: 0.003,
          veryfrontChargeUsd: 0.005,
          veryfrontBilledUsd: 0.2,
          costCredits: 2,
          costSource: "gateway",
          billingMode: "deferred",
          cacheReadInputTokens: 3,
          cachedInputTokens: 3,
          reasoningTokens: 3,
          usageCaptureStatus: "complete",
        },
        metrics: [
          {
            name: "answer.contains",
            family: "answer",
            severity: "gate",
            score: 0,
            pass: false,
            explanation: "Expected Paris, got Lyon.",
            evidence: { expected: "Paris", actual: "Lyon" },
          },
          {
            name: "judge.rubric",
            family: "judge",
            severity: "soft",
            skipped: true,
            explanation: "No judge configured.",
          },
        ],
      }),
      createRecord({
        id: "q2:1",
        exampleId: "q2",
        repetition: 1,
        completed: false,
        error: "AG-UI request failed",
        durationMs: 200,
        usage: {},
        metrics: [],
      }),
    ]);

    assertEquals(summary.records, 3);
    assertEquals(summary.passed, 1);
    assertEquals(summary.failed, 2);
    assertEquals(summary.skippedResults, 1);
    assertEquals(summary.passRate, 1 / 3);
    assertEquals(summary.duration, {
      totalMs: 600,
      minMs: 100,
      maxMs: 300,
      meanMs: 200,
      p50Ms: 200,
      p95Ms: 300,
    });
    assertEquals(summary.usage, {
      inputTokens: 22,
      outputTokens: 11,
      totalTokens: 33,
      billableInputTokens: 22,
      billableOutputTokens: 16,
      costUsd: 0.003,
      providerInputCostUsd: 0.0012000000000000001,
      providerOutputCostUsd: 0.0018,
      providerCostUsd: 0.003,
      veryfrontInputChargeUsd: 0.003,
      veryfrontOutputChargeUsd: 0.0045000000000000005,
      veryfrontChargeUsd: 0.0075,
      veryfrontBilledUsd: 0.30000000000000004,
      costCredits: 3,
      costSource: "partial",
      billingMode: "deferred",
      cacheReadInputTokens: 5,
      cachedInputTokens: 5,
      reasoningTokens: 5,
      usageCaptureStatus: "partial",
    });
    assertEquals(summary.gateFailures, [
      {
        recordId: "q1:2",
        exampleId: "q1",
        repetition: 2,
        name: "answer.contains",
        family: "answer",
        severity: "gate",
        explanation: "Expected Paris, got Lyon.",
        evidence: { expected: "Paris", actual: "Lyon" },
      },
      {
        recordId: "q2:1",
        exampleId: "q2",
        repetition: 1,
        name: "record.error",
        family: "check",
        severity: "gate",
        explanation: "AG-UI request failed",
      },
    ]);
    assertEquals(summary.failedExamples, [
      {
        exampleId: "q1",
        records: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
        flaky: true,
      },
      {
        exampleId: "q2",
        records: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
        flaky: false,
      },
    ]);
    assertEquals(summary.flakes, {
      examples: 2,
      stablePassed: 0,
      stableFailed: 1,
      flaky: 1,
    });
  });

  it("returns empty aggregate fields for an empty report", () => {
    assertEquals(summarizeEvalRecords([]), {
      records: 0,
      passed: 0,
      failed: 0,
      passRate: 1,
      skippedResults: 0,
      metrics: [],
      duration: {
        totalMs: 0,
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
      },
      usage: {},
      gateFailures: [],
      failedExamples: [],
      flakes: {
        examples: 0,
        stablePassed: 0,
        stableFailed: 0,
        flaky: 0,
      },
    });
  });

  it("does not derive billed USD from gateway credits", () => {
    const summary = summarizeEvalRecords([
      createRecord({
        id: "q1:1",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          veryfrontChargeUsd: 0.01,
          costCredits: 4,
          costSource: "gateway",
        },
      }),
      createRecord({
        id: "q2:1",
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          veryfrontChargeUsd: 0.02,
          costCredits: 16,
          costSource: "gateway",
        },
      }),
    ]);

    assertEquals(summary.usage?.veryfrontBilledUsd, undefined);
    assertEquals(summary.usage?.costCredits, 20);
  });
});
