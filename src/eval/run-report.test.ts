import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DiscoveredEval } from "./discovery.ts";
import type {
  EvalReport,
  EvalReportComparisonPolicy,
  EvalReportExportConfig,
  EvalRunProvenance,
} from "./types.ts";
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

const registry = {
  register: () => {},
  unregister: () => {},
  get: () => undefined,
  require: () => {
    throw new Error("not implemented");
  },
  list: () => [],
  has: () => false,
  export: () => Promise.resolve([]),
} satisfies NonNullable<EvalReportExportConfig["registry"]>;

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
  exportReport?: (
    report: EvalReport,
    config?: EvalReportExportConfig,
  ) => Promise<EvalReport> | EvalReport;
} = {}) {
  const events: string[] = [];
  const writes: WriteCall[] = [];
  const targetRuns: TargetRun[] = [];
  const exportConfigs: Array<EvalReportExportConfig | undefined> = [];
  return {
    events,
    writes,
    targetRuns,
    exportConfigs,
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
        exportReport: async (report: EvalReport, config?: EvalReportExportConfig) => {
          events.push("export");
          exportConfigs.push(config);
          return options.exportReport ? await options.exportReport(report, config) : report;
        },
      },
      clock: {
        now: () => now,
        createSuffix: () => "abcdef12",
      },
    },
  };
}

function expectedMarkdownReport(
  report: EvalReport,
  baselineStatus: "ok" | "regressed",
  passRateDelta: number,
  newFailedExamples: string[] = [],
): string {
  const direction = passRateDelta >= 0 ? "+" : "";
  const newFailedLine = newFailedExamples.length > 0
    ? `New failed examples: ${newFailedExamples.join(", ")}\n`
    : "";
  return `# Eval report: eval:answers

Run: \`${report.runId}\`
Target: \`agent:answers\`
Result: \`1/1 passed (100%)\`

## Metrics

| Metric | Severity | Passed | Failed | Pass rate |
| --- | --- | ---: | ---: | ---: |
| \`answer.correct\` | gate | 1 | 0 | 100% |

## Usage

| Usage | Value |
| --- | ---: |
| Total tokens | 12 |
| Billing mode | direct |

## Examples

| Example | Result | Duration | Tokens | Billed USD | Credits |
| --- | ---: | ---: | ---: | ---: | ---: |
| \`eval:answers/example-1/1\` | PASS | 1.000s | 12 | - | - |

## Baseline

Status: \`${baselineStatus}\`
Pass rate delta: \`${direction}${Math.round(passRateDelta * 100)} pp\`
${newFailedLine}
## Exports

- \`json\`: ok
`;
}

function expectedJunitXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="eval:answers" tests="1" failures="0" skipped="0">
  <testcase classname="eval:answers" name="example-1#1" time="1.000" />
</testsuite>
`;
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
    const { adapters, events, targetRuns, writes, exportConfigs } = createAdapters({
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
      exportConfig: {
        registry,
        exporterIds: ["json"],
        required: true,
        context: {
          projectReference: "project-a",
          environment: "ci",
          tags: ["suite", "smoke"],
          metadata: { owner: "eval-team" },
          redaction: { includeOutputs: true, metadataAllowlist: ["owner"] },
        },
      },
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
    assertEquals(exportConfigs, [{
      registry,
      exporterIds: ["json"],
      required: true,
      context: {
        projectReference: "project-a",
        environment: "ci",
        evalId: "eval:answers",
        sourcePath: "evals/answers.eval.ts",
        reportPath: "artifacts/current.json",
        tags: ["suite", "smoke"],
        metadata: { owner: "eval-team" },
        redaction: { includeOutputs: true, metadataAllowlist: ["owner"] },
      },
    }]);
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
    const reportWrite = writes[3]!;
    const junitWrite = writes[4]!;
    assertEquals(
      summaryWrite.content,
      JSON.stringify(
        {
          kind: "eval-summary",
          schemaVersion: 2,
          runId: report.runId,
          definitionId: "eval:answers",
          targetKind: "agent",
          target: "agent:answers",
          startedAt: "2026-06-21T01:02:03.004Z",
          endedAt: "2026-06-21T01:02:04.004Z",
          summary: report.summary,
          metadata: report.metadata,
          exports: [{ exporterId: "json", ok: true }],
          baseline: outcome.baseline,
        },
        null,
        2,
      ),
    );
    assertEquals(resultsWrite.content, `${JSON.stringify(report.records[0])}\n`);
    assertEquals(
      markdownWrite.content,
      expectedMarkdownReport(
        { ...report, exports: [{ exporterId: "json", ok: true }] },
        "ok",
        1,
      ),
    );
    assertEquals(
      reportWrite.content,
      JSON.stringify({ ...report, exports: [{ exporterId: "json", ok: true }] }, null, 2),
    );
    assertEquals(junitWrite.content, expectedJunitXml());
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
      exportConfig: { required: false },
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
      exportConfig: { required: false },
      provenance,
    }, adapters);

    assertEquals(outcome.report.summary.failed, 0);
    assertEquals(outcome.baseline?.regressed, true);
    assertEquals(outcome.exitCode, 1);
  });

  it("preserves caller-resolved export context when merging module defaults", async () => {
    const { adapters, exportConfigs } = createAdapters();

    await runEvalReport({
      kind: "single",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo",
      evalItem: createDiscoveredEval(),
      targetKind: "agent",
      target: "agent:answers",
      targetAdapter: { kind: "agent-adapter" },
      exportConfig: {
        exporterIds: ["json"],
        context: {
          evalId: "caller-eval-id",
          sourcePath: "already/relative.eval.ts",
          reportPath: "already/report.json",
          projectReference: "project-a",
        },
      },
      provenance,
    }, adapters);

    assertEquals(exportConfigs, [{
      exporterIds: ["json"],
      context: {
        evalId: "caller-eval-id",
        sourcePath: "already/relative.eval.ts",
        reportPath: "already/report.json",
        projectReference: "project-a",
      },
    }]);
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
      exportConfig: { required: false },
    }, bestEffort.adapters);
    const requiredOutcome = await runEvalReport({
      ...baseInput,
      exportConfig: { required: true },
    }, required.adapters);

    assertEquals(bestEffortOutcome.exitCode, 0);
    assertEquals(requiredOutcome.exitCode, 1);
    assertEquals(bestEffort.exportConfigs, [{
      required: false,
      context: {
        evalId: "eval:answers",
        sourcePath: "evals/answers.eval.ts",
        reportPath: ".veryfront/evals/20260621_010203004_abcdef12-answers/summary.json",
      },
    }]);
    assertEquals(required.exportConfigs, [{
      required: true,
      context: {
        evalId: "eval:answers",
        sourcePath: "evals/answers.eval.ts",
        reportPath: ".veryfront/evals/20260621_010203004_abcdef12-answers/summary.json",
      },
    }]);
    assertEquals(bestEffort.writes.length, 3);
    assertEquals(required.writes.length, 3);
    assertEquals(required.events.includes("export"), true);
  });
});
