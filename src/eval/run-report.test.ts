import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DiscoveredEval } from "./discovery.ts";
import type { EvalReport, EvalReportComparisonPolicy, EvalRunProvenance } from "./types.ts";
import { runEvalReport } from "./run-report.ts";

const now = new Date("2026-06-21T01:02:03.004Z");
const provenance: EvalRunProvenance = {
  kind: "eval-run-provenance",
  environment: "local",
  source: { kind: "workspace" },
  frameworkVersion: "1.2.3",
};

type WriteCall = {
  path: string;
  content: string;
};

type TargetRun = {
  baseDir: string;
  runId: string;
  frameworkVersion: string;
  targetKind: "agent" | "tool";
  target: string;
  targetAdapter: unknown;
  selectedModel?: string;
  maxOutputTokens?: number;
  metadata: unknown;
};

function createDiscoveredEval(): DiscoveredEval {
  return {
    id: "eval:answers",
    name: "Answers",
    filePath: "/repo/evals/answers.eval.ts",
    exportName: "answers",
    definition: {
      kind: "eval",
      id: "eval:answers",
      name: "Answers",
      targetKind: "agent",
      target: "agent:answers",
      dataset: {
        kind: "inline",
        examples: [{ id: "example-1", input: "What is Veryfront?" }],
        load: () => Promise.resolve([{ id: "example-1", input: "What is Veryfront?" }]),
      },
      metrics: [],
      repetitions: 1,
      tags: [],
      metadata: {},
    },
  };
}

function createReport(
  overrides: Partial<EvalReport> = {},
): EvalReport {
  const runId = overrides.runId ?? "evalrun_20260621_010203004_abcdef12";
  return {
    kind: "eval-report",
    schemaVersion: 2,
    runId,
    definitionId: "eval:answers",
    targetKind: "agent",
    target: "agent:answers",
    startedAt: "2026-06-21T01:02:03.004Z",
    endedAt: "2026-06-21T01:02:04.004Z",
    summary: {
      records: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      metrics: [{
        name: "answer.correct",
        family: "answer",
        severity: "gate",
        passed: 1,
        failed: 0,
        skipped: 0,
        passRate: 1,
      }],
      failedExamples: [],
      usage: { totalTokens: 12, billingMode: "direct" },
    },
    records: [{
      id: "eval:answers/example-1/1",
      evalId: "eval:answers",
      exampleId: "example-1",
      repetition: 1,
      input: "What is Veryfront?",
      output: "A framework.",
      metadata: {},
      trace: { events: [], toolCalls: [] },
      usage: { totalTokens: 12 },
      durationMs: 1000,
      completed: true,
      metrics: [{
        name: "answer.correct",
        family: "answer",
        severity: "gate",
        pass: true,
      }],
    }],
    metadata: { provenance },
    ...overrides,
  };
}

function createFailingReport(): EvalReport {
  return createReport({
    summary: {
      records: 1,
      passed: 0,
      failed: 1,
      passRate: 0,
      metrics: [{
        name: "answer.correct",
        family: "answer",
        severity: "gate",
        passed: 0,
        failed: 1,
        skipped: 0,
        passRate: 0,
      }],
      failedExamples: [{
        exampleId: "example-1",
        records: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
        flaky: false,
      }],
    },
    records: [{
      id: "eval:answers/example-1/1",
      evalId: "eval:answers",
      exampleId: "example-1",
      repetition: 1,
      input: "What is Veryfront?",
      output: "Wrong.",
      metadata: {},
      trace: { events: [], toolCalls: [] },
      usage: {},
      durationMs: 1000,
      completed: true,
      metrics: [{
        name: "answer.correct",
        family: "answer",
        severity: "gate",
        pass: false,
        explanation: "Wrong answer.",
      }],
    }],
  });
}

function createAdapters(options: {
  report?: EvalReport;
  baselineText?: string;
  exportReport?: (report: EvalReport) => Promise<EvalReport> | EvalReport;
} = {}) {
  const events: string[] = [];
  const writes: WriteCall[] = [];
  const targetRuns: TargetRun[] = [];
  return {
    events,
    writes,
    targetRuns,
    adapters: {
      targets: {
        runEval: (_evalItem: DiscoveredEval, runOptions: TargetRun) => {
          events.push("target");
          targetRuns.push(runOptions);
          return Promise.resolve(options.report ?? createReport({ runId: runOptions.runId }));
        },
      },
      artifacts: {
        readTextFile: (path: string) => {
          events.push(`read:${path}`);
          return Promise.resolve(options.baselineText ?? JSON.stringify(createReport()));
        },
        writeTextFileEnsuringDir: (path: string, content: string) => {
          events.push(`write:${path}`);
          writes.push({ path, content });
          return Promise.resolve();
        },
      },
      billing: {
        runWithGatewayBillingGroup: async (
          billingGroupId: string,
          operation: () => Promise<EvalReport>,
        ) => {
          events.push(`billing:start:${billingGroupId}`);
          const report = await operation();
          events.push(`billing:end:${billingGroupId}`);
          return report;
        },
      },
      exporters: {
        exportReport: async (report: EvalReport) => {
          events.push("export");
          return options.exportReport ? await options.exportReport(report) : report;
        },
      },
      clock: {
        now: () => now,
        createSuffix: () => "abcdef12",
      },
    },
  };
}

describe("runEvalReport single mode", () => {
  it("runs a single eval with deterministic paths, billing before export, baseline, and artifacts", async () => {
    const evalItem = createDiscoveredEval();
    const report = createReport();
    const baseline = createReport({
      runId: "evalrun_20260620_010203004_baseline",
      summary: {
        ...report.summary,
        passed: 0,
        failed: 1,
        passRate: 0,
        failedExamples: [{
          exampleId: "legacy-failure",
          records: 1,
          passed: 0,
          failed: 1,
          passRate: 0,
          flaky: false,
        }],
      },
    });
    const { adapters, events, targetRuns, writes } = createAdapters({
      report,
      baselineText: JSON.stringify(baseline),
      exportReport: (input) => ({
        ...input,
        exports: [{ exporterId: "json", ok: true }],
      }),
    });

    const outcome = await runEvalReport({
      kind: "single",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo/data",
      evalItem,
      targetKind: "agent",
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      selectedModel: "gpt-test",
      maxOutputTokens: 512,
      baseline: "baselines/answers.json",
      writeBaseline: "baselines/current.json",
      report: "artifacts/current.json",
      junit: "artifacts/junit.xml",
      baselinePolicy: {} satisfies EvalReportComparisonPolicy,
      exportRequired: true,
      exportContext: { projectReference: "project-a" },
      provenance,
    }, adapters);

    assertEquals(outcome.kind, "single");
    assertEquals(outcome.exitCode, 0);
    assertEquals(outcome.summary, {
      runId: "evalrun_20260621_010203004_abcdef12",
      evalId: "eval:answers",
      target: "agent:answers",
      records: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      metrics: report.summary.metrics,
    });
    assertEquals(outcome.artifacts, {
      directory: ".veryfront/evals/20260621_010203004_abcdef12-answers",
      summary: ".veryfront/evals/20260621_010203004_abcdef12-answers/summary.json",
      results: ".veryfront/evals/20260621_010203004_abcdef12-answers/results.jsonl",
      reportMarkdown: ".veryfront/evals/20260621_010203004_abcdef12-answers/report.md",
    });
    assertEquals(outcome.baseline?.baselineRunId, baseline.runId);
    assertEquals(outcome.outputHints, {
      reportDirectory: outcome.artifacts.directory,
      reportMarkdown: outcome.artifacts.reportMarkdown,
      report: "artifacts/current.json",
      junit: "artifacts/junit.xml",
      baselineWritten: "baselines/current.json",
    });
    assertEquals(targetRuns, [{
      baseDir: "/repo/data",
      runId: "evalrun_20260621_010203004_abcdef12",
      frameworkVersion: "1.2.3",
      targetKind: "agent",
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      selectedModel: "gpt-test",
      maxOutputTokens: 512,
      metadata: {
        provenance,
        model: "gpt-test",
      },
    }]);
    assertEquals(events.slice(0, 5), [
      "billing:start:evalrun_20260621_010203004_abcdef12_gpt-test",
      "target",
      "billing:end:evalrun_20260621_010203004_abcdef12_gpt-test",
      "export",
      "read:baselines/answers.json",
    ]);
    assertEquals(writes.map((write) => write.path), [
      outcome.artifacts.summary,
      outcome.artifacts.results,
      outcome.artifacts.reportMarkdown,
      "artifacts/current.json",
      "artifacts/junit.xml",
      "baselines/current.json",
    ]);
    const summaryWrite = writes[0]!;
    const resultsWrite = writes[1]!;
    const markdownWrite = writes[2]!;
    const junitWrite = writes[4]!;
    assertStringIncludes(summaryWrite.content, '"kind": "eval-summary"');
    assertEquals(resultsWrite.content, `${JSON.stringify(report.records[0])}\n`);
    assertStringIncludes(markdownWrite.content, "# Eval report: eval:answers");
    assertStringIncludes(junitWrite.content, '<testsuite name="eval:answers" tests="1"');
  });

  it("returns exit 1 for failed records and baseline regressions", async () => {
    const { adapters } = createAdapters({
      report: createFailingReport(),
      baselineText: JSON.stringify(createReport()),
    });

    const outcome = await runEvalReport({
      kind: "single",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo",
      evalItem: createDiscoveredEval(),
      targetKind: "agent",
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      baseline: "baselines/answers.json",
      baselinePolicy: {} satisfies EvalReportComparisonPolicy,
      exportRequired: false,
      provenance,
    }, adapters);

    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.report.summary.failed, 1);
    assertEquals(outcome.baseline?.regressed, true);
  });

  it("returns exit 1 when a passing report regresses against a stronger baseline", async () => {
    const current = createReport({
      summary: {
        ...createReport().summary,
        usage: { totalTokens: 12 },
      },
    });
    const strongerBaseline = createReport({
      runId: "evalrun_20260620_010203004_baseline",
      summary: {
        ...createReport().summary,
        usage: { totalTokens: 1 },
      },
    });
    const { adapters } = createAdapters({
      report: current,
      baselineText: JSON.stringify(strongerBaseline),
    });

    const outcome = await runEvalReport({
      kind: "single",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo",
      evalItem: createDiscoveredEval(),
      targetKind: "agent",
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      baseline: "baselines/answers.json",
      baselinePolicy: { usageIncreaseThreshold: 0.5 },
      exportRequired: false,
      provenance,
    }, adapters);

    assertEquals(outcome.report.summary.failed, 0);
    assertEquals(outcome.baseline?.regressed, true);
    assertEquals(outcome.exitCode, 1);
  });

  it("gates only required export failures after local artifacts are written", async () => {
    const exportFailed = (report: EvalReport) => ({
      ...report,
      exports: [{ exporterId: "json", ok: false as const, error: "boom" }],
    });
    const bestEffort = createAdapters({ exportReport: exportFailed });
    const required = createAdapters({ exportReport: exportFailed });
    const baseInput = {
      kind: "single" as const,
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo",
      evalItem: createDiscoveredEval(),
      targetKind: "agent" as const,
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      baselinePolicy: {} satisfies EvalReportComparisonPolicy,
      provenance,
    };

    const bestEffortOutcome = await runEvalReport({
      ...baseInput,
      exportRequired: false,
    }, bestEffort.adapters);
    const requiredOutcome = await runEvalReport({
      ...baseInput,
      exportRequired: true,
    }, required.adapters);

    assertEquals(bestEffortOutcome.exitCode, 0);
    assertEquals(requiredOutcome.exitCode, 1);
    assertEquals(bestEffort.writes.length, 3);
    assertEquals(required.writes.length, 3);
    assertEquals(required.events.includes("export"), true);
  });
});
