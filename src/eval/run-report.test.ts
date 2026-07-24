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

function createSuiteEval(
  id: string,
  filePath: string,
  target: string,
  name = id,
): DiscoveredEval {
  return {
    ...createDiscoveredEval(),
    id,
    name,
    filePath,
    exportName: sanitizeTestExportName(id),
    definition: {
      ...createDiscoveredEval().definition,
      id,
      name,
      target,
    },
  };
}

function sanitizeTestExportName(id: string): string {
  return id.replace(/^eval:/, "").replace(/[^A-Za-z0-9_]+/g, "_");
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
    if (outcome.kind !== "single") throw new Error("expected single outcome");
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
    if (outcome.kind !== "single") throw new Error("expected single outcome");
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

    if (outcome.kind !== "single") throw new Error("expected single outcome");
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

describe("runEvalReport suite mode", () => {
  it("runs evals sorted by id and file path with sequential child ids, artifacts, and output events", async () => {
    const beta = createSuiteEval("eval:beta", "/repo/evals/beta.eval.ts", "agent:beta", "Beta");
    const alphaB = createSuiteEval(
      "eval:alpha",
      "/repo/evals/z-alpha.eval.ts",
      "agent:missing",
      "Alpha missing",
    );
    const alphaA = createSuiteEval(
      "eval:alpha",
      "/repo/evals/a-alpha.eval.ts",
      "agent:alpha",
      "Alpha",
    );
    const gamma = createSuiteEval("eval:gamma", "/external/gamma.eval.ts", "agent:gamma", "Gamma");
    alphaA.definition.tags = ["alpha-default"];
    alphaA.definition.metadata = { team: "evals" };
    beta.definition.tags = ["beta-default"];
    beta.definition.metadata = { priority: "high" };
    const events: string[] = [];
    const writes: WriteCall[] = [];
    const targetRuns: TargetRun[] = [];
    const exportConfigs: Array<EvalReportExportConfig | undefined> = [];
    const betaFailure = createFailingReport();
    const reportById = new Map([
      ["eval:alpha", createReport({ definitionId: "eval:alpha", target: "agent:alpha" })],
      ["eval:beta", { ...betaFailure, definitionId: "eval:beta", target: "agent:beta" }],
      [
        "eval:gamma",
        createReport({
          definitionId: "eval:gamma",
          target: "agent:gamma",
          records: [],
          summary: {
            records: 0,
            passed: 0,
            failed: 0,
            passRate: 1,
            metrics: [],
            failedExamples: [],
          },
        }),
      ],
    ]);

    const outcome = await runEvalReport({
      kind: "suite",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      datasetBase: "/repo/data",
      reportDir: "suite",
      junit: "suite/junit.xml",
      evalItems: [beta, alphaB, gamma, alphaA],
      exportConfig: {
        registry,
        exporterIds: ["json"],
        required: true,
        context: {
          projectReference: "project-a",
        },
      },
      provenance,
    }, {
      targets: {
        resolveTarget: (evalItem: DiscoveredEval) => {
          events.push(`resolve:${evalItem.name}`);
          if (evalItem.name === "Alpha missing") {
            throw new Error('Agent "missing" was not found.');
          }
          return {
            targetKind: evalItem.definition.targetKind,
            target: evalItem.definition.target,
            targetAdapter: { id: evalItem.definition.target },
          };
        },
        runEval: (evalItem: DiscoveredEval, runOptions: TargetRun) => {
          events.push(`target:${evalItem.name}`);
          targetRuns.push(runOptions);
          const report = reportById.get(evalItem.id);
          if (!report) throw new Error(`missing report for ${evalItem.id}`);
          return Promise.resolve({
            ...report,
            runId: runOptions.runId,
            targetKind: runOptions.targetKind,
            target: runOptions.target,
            records: report.records.map((record) => ({ ...record, evalId: evalItem.id })),
          });
        },
      },
      artifacts: {
        readTextFile: (path: string) => {
          events.push(`read:${path}`);
          return Promise.resolve("");
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
        exportReport: (report: EvalReport, config?: EvalReportExportConfig) => {
          events.push(`export:${report.definitionId}`);
          exportConfigs.push(config);
          if (report.definitionId === "eval:gamma") {
            return Promise.resolve({
              ...report,
              exports: [{ exporterId: "json", ok: false, error: "export unavailable" }],
            });
          }
          return Promise.resolve({
            ...report,
            exports: [{ exporterId: "json", ok: true }],
          });
        },
      },
      clock: {
        now: () => now,
        createSuffix: () => "abcdef12",
      },
    });

    assertEquals(outcome.kind, "suite");
    if (outcome.kind !== "suite") throw new Error("expected suite outcome");
    assertEquals(outcome.exitCode, 1);
    assertEquals(outcome.artifacts, {
      directory: "suite",
      summary: "suite/summary.json",
      results: "suite/results.jsonl",
      reportMarkdown: "suite/report.md",
    });
    assertEquals(outcome.outputHints, {
      reportDirectory: "suite",
      reportMarkdown: "suite/report.md",
      junit: "suite/junit.xml",
      children: outcome.outputHints.children,
    });
    assertEquals(outcome.outputHints.children, [
      {
        kind: "report",
        evalId: "eval:alpha",
        reportDirectory: "suite/001-alpha",
        report: {
          ...reportById.get("eval:alpha")!,
          runId: "evalrun_20260621_010203004_abcdef12_001",
          targetKind: "agent",
          target: "agent:alpha",
          records: reportById.get("eval:alpha")!.records.map((record) => ({
            ...record,
            evalId: "eval:alpha",
          })),
          exports: [{ exporterId: "json", ok: true }],
        },
      },
      {
        kind: "error",
        evalId: "eval:alpha",
        error: 'Agent "missing" was not found.',
      },
      {
        kind: "report",
        evalId: "eval:beta",
        reportDirectory: "suite/003-beta",
        report: {
          ...reportById.get("eval:beta")!,
          runId: "evalrun_20260621_010203004_abcdef12_003",
          targetKind: "agent",
          target: "agent:beta",
          records: reportById.get("eval:beta")!.records.map((record) => ({
            ...record,
            evalId: "eval:beta",
          })),
          exports: [{ exporterId: "json", ok: true }],
        },
      },
      {
        kind: "report",
        evalId: "eval:gamma",
        reportDirectory: "suite/004-gamma",
        report: {
          ...reportById.get("eval:gamma")!,
          runId: "evalrun_20260621_010203004_abcdef12_004",
          targetKind: "agent",
          target: "agent:gamma",
          records: [],
          exports: [{ exporterId: "json", ok: false, error: "export unavailable" }],
        },
      },
    ]);
    assertEquals(outcome.suite, {
      kind: "eval-suite-summary",
      runId: "evalrun_20260621_010203004_abcdef12",
      startedAt: "2026-06-21T01:02:03.004Z",
      endedAt: "2026-06-21T01:02:03.004Z",
      total: 4,
      passed: 1,
      failed: 3,
      results: [
        {
          id: "eval:alpha",
          name: "Alpha",
          target: "agent:alpha",
          status: "passed",
          artifacts: {
            directory: "suite/001-alpha",
            summary: "suite/001-alpha/summary.json",
            results: "suite/001-alpha/results.jsonl",
            reportMarkdown: "suite/001-alpha/report.md",
          },
          summary: {
            runId: "evalrun_20260621_010203004_abcdef12_001",
            evalId: "eval:alpha",
            target: "agent:alpha",
            records: 1,
            passed: 1,
            failed: 0,
            passRate: 1,
            metrics: createReport().summary.metrics,
          },
        },
        {
          id: "eval:alpha",
          name: "Alpha missing",
          target: "agent:missing",
          status: "error",
          artifacts: {
            directory: "suite/002-alpha",
            summary: "suite/002-alpha/summary.json",
            results: "suite/002-alpha/results.jsonl",
            reportMarkdown: "suite/002-alpha/report.md",
          },
          error: 'Agent "missing" was not found.',
        },
        {
          id: "eval:beta",
          name: "Beta",
          target: "agent:beta",
          status: "failed",
          artifacts: {
            directory: "suite/003-beta",
            summary: "suite/003-beta/summary.json",
            results: "suite/003-beta/results.jsonl",
            reportMarkdown: "suite/003-beta/report.md",
          },
          summary: {
            runId: "evalrun_20260621_010203004_abcdef12_003",
            evalId: "eval:beta",
            target: "agent:beta",
            records: 1,
            passed: 0,
            failed: 1,
            passRate: 0,
            metrics: createFailingReport().summary.metrics,
          },
        },
        {
          id: "eval:gamma",
          name: "Gamma",
          target: "agent:gamma",
          status: "failed",
          artifacts: {
            directory: "suite/004-gamma",
            summary: "suite/004-gamma/summary.json",
            results: "suite/004-gamma/results.jsonl",
            reportMarkdown: "suite/004-gamma/report.md",
          },
          summary: {
            runId: "evalrun_20260621_010203004_abcdef12_004",
            evalId: "eval:gamma",
            target: "agent:gamma",
            records: 0,
            passed: 0,
            failed: 0,
            passRate: 1,
            metrics: [],
          },
        },
      ],
    });
    assertEquals(targetRuns.map((run) => run.runId), [
      "evalrun_20260621_010203004_abcdef12_001",
      "evalrun_20260621_010203004_abcdef12_003",
      "evalrun_20260621_010203004_abcdef12_004",
    ]);
    assertEquals(targetRuns.map((run) => run.metadata), [
      { provenance },
      { provenance },
      { provenance },
    ]);
    assertEquals(events, [
      "resolve:Alpha",
      "billing:start:evalrun_20260621_010203004_abcdef12_001",
      "target:Alpha",
      "billing:end:evalrun_20260621_010203004_abcdef12_001",
      "export:eval:alpha",
      "write:suite/001-alpha/summary.json",
      "write:suite/001-alpha/results.jsonl",
      "write:suite/001-alpha/report.md",
      "resolve:Alpha missing",
      "resolve:Beta",
      "billing:start:evalrun_20260621_010203004_abcdef12_003",
      "target:Beta",
      "billing:end:evalrun_20260621_010203004_abcdef12_003",
      "export:eval:beta",
      "write:suite/003-beta/summary.json",
      "write:suite/003-beta/results.jsonl",
      "write:suite/003-beta/report.md",
      "resolve:Gamma",
      "billing:start:evalrun_20260621_010203004_abcdef12_004",
      "target:Gamma",
      "billing:end:evalrun_20260621_010203004_abcdef12_004",
      "export:eval:gamma",
      "write:suite/004-gamma/summary.json",
      "write:suite/004-gamma/results.jsonl",
      "write:suite/004-gamma/report.md",
      "write:suite/summary.json",
      "write:suite/results.jsonl",
      "write:suite/report.md",
      "write:suite/junit.xml",
    ]);
    assertEquals(exportConfigs.map((config) => config?.context), [
      {
        evalId: "eval:alpha",
        sourcePath: "evals/a-alpha.eval.ts",
        reportPath: "suite/001-alpha/summary.json",
        tags: ["alpha-default"],
        metadata: { team: "evals" },
        projectReference: "project-a",
      },
      {
        evalId: "eval:beta",
        sourcePath: "evals/beta.eval.ts",
        reportPath: "suite/003-beta/summary.json",
        tags: ["beta-default"],
        metadata: { priority: "high" },
        projectReference: "project-a",
      },
      {
        evalId: "eval:gamma",
        sourcePath: "/external/gamma.eval.ts",
        reportPath: "suite/004-gamma/summary.json",
        projectReference: "project-a",
      },
    ]);
    assertEquals(
      writes.find((write) => write.path === "suite/004-gamma/results.jsonl")?.content,
      "",
    );
    assertEquals(
      writes.find((write) => write.path === "suite/results.jsonl")?.content,
      `${outcome.suite.results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    );
    assertEquals(
      writes.find((write) => write.path === "suite/report.md")?.content,
      `# Eval suite report

Run: \`evalrun_20260621_010203004_abcdef12\`
Result: \`1/4 passed\`

| Eval | Status | Records | Error |
| --- | --- | --- | --- |
| eval:alpha | passed | 1/1 |  |
| eval:alpha | error | n/a | Agent "missing" was not found. |
| eval:beta | failed | 0/1 |  |
| eval:gamma | failed | 0/0 |  |
`,
    );
    assertEquals(
      writes.find((write) => write.path === "suite/junit.xml")?.content,
      `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="4" failures="3" skipped="0">
  <testsuite name="veryfront eval suite" tests="4" failures="3" skipped="0">
    <testcase classname="eval" name="eval:alpha" />
    <testcase classname="eval" name="eval:alpha">
      <failure message="Agent &quot;missing&quot; was not found.">Agent &quot;missing&quot; was not found.</failure>
    </testcase>
    <testcase classname="eval" name="eval:beta">
      <failure message="1 record(s) failed">1 record(s) failed</failure>
    </testcase>
    <testcase classname="eval" name="eval:gamma">
      <failure message="A required eval export failed.">A required eval export failed.</failure>
    </testcase>
  </testsuite>
</testsuites>
`,
    );
  });

  it("writes an empty suite JSONL file without a trailing newline", async () => {
    const writes: WriteCall[] = [];

    const outcome = await runEvalReport({
      kind: "suite",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      reportDir: "empty-suite",
      evalItems: [],
      provenance,
    }, {
      ...createAdapters().adapters,
      artifacts: {
        readTextFile: () => Promise.resolve(""),
        writeTextFileEnsuringDir: (path: string, content: string) => {
          writes.push({ path, content });
          return Promise.resolve();
        },
      },
    });

    assertEquals(outcome.exitCode, 0);
    if (outcome.kind !== "suite") throw new Error("expected suite outcome");
    assertEquals(outcome.suite.total, 0);
    assertEquals(writes.find((write) => write.path === "empty-suite/results.jsonl")?.content, "");
  });

  it("defaults the suite report directory to the parent run id without a label suffix", async () => {
    const outcome = await runEvalReport({
      kind: "suite",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      evalItems: [],
      provenance,
    }, {
      ...createAdapters().adapters,
      artifacts: {
        readTextFile: () => Promise.resolve(""),
        writeTextFileEnsuringDir: () => Promise.resolve(),
      },
      clock: {
        now: () => now,
        createSuffix: () => "abcdef12",
      },
    });

    assertEquals(outcome.artifacts, {
      directory: ".veryfront/evals/20260621_010203004_abcdef12",
      summary: ".veryfront/evals/20260621_010203004_abcdef12/summary.json",
      results: ".veryfront/evals/20260621_010203004_abcdef12/results.jsonl",
      reportMarkdown: ".veryfront/evals/20260621_010203004_abcdef12/report.md",
    });
  });

  it("preserves caller-resolved child export context fields", async () => {
    const evalItem = createSuiteEval(
      "eval:context",
      "/repo/evals/context.eval.ts",
      "agent:context",
      "Context",
    );
    evalItem.definition.tags = ["default-tag"];
    evalItem.definition.metadata = { owner: "definition-owner" };
    const { adapters, exportConfigs } = createAdapters({
      report: createReport({ definitionId: "eval:context", target: "agent:context" }),
    });

    await runEvalReport({
      kind: "suite",
      projectDir: "/repo",
      frameworkVersion: "1.2.3",
      reportDir: "suite-context",
      evalItems: [evalItem],
      exportConfig: {
        registry,
        exporterIds: ["json"],
        required: false,
        context: {
          evalId: "caller-eval",
          sourcePath: "caller/source.eval.ts",
          reportPath: "caller/report.json",
          tags: ["caller-tag"],
          metadata: { owner: "caller-owner" },
        },
      },
      provenance,
    }, {
      ...adapters,
      targets: {
        ...adapters.targets,
        resolveTarget: () => ({
          targetKind: "agent",
          target: "agent:context",
          targetAdapter: {},
        }),
      },
    });

    assertEquals(exportConfigs, [{
      registry,
      exporterIds: ["json"],
      required: false,
      context: {
        evalId: "caller-eval",
        sourcePath: "caller/source.eval.ts",
        reportPath: "caller/report.json",
        tags: ["caller-tag"],
        metadata: { owner: "caller-owner" },
      },
    }]);
  });
});
