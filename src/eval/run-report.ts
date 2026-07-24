import { join } from "@std/path";
import { compareEvalReports, createEvalRunId, EVAL_REPORT_SCHEMA_VERSION } from "./index.ts";
import type { DiscoveredEval } from "./discovery.ts";
import type {
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  EvalReportComparison,
  EvalReportComparisonPolicy,
  EvalReportExportConfig,
  EvalRunProvenance,
  EvalUsage,
} from "./types.ts";

type CliEvalSummary = {
  runId: string;
  evalId: string;
  target: string;
  records: number;
  passed: number;
  failed: number;
  passRate: number;
  metrics: EvalReport["summary"]["metrics"];
};

type EvalArtifactPaths = {
  directory: string;
  summary: string;
  results: string;
  reportMarkdown: string;
};

type EvalSummaryArtifact = {
  kind: "eval-summary";
  schemaVersion: number;
  runId: string;
  definitionId: string;
  targetKind: EvalReport["targetKind"];
  target: string;
  dataset?: EvalReport["dataset"];
  startedAt: string;
  endedAt: string;
  summary: EvalReport["summary"];
  metadata?: EvalReport["metadata"];
  exports?: EvalReport["exports"];
  baseline?: EvalReportComparison;
};

type EvalRunReportOutputHints = {
  reportDirectory: string;
  reportMarkdown: string;
  report?: string;
  junit?: string;
  baselineWritten?: string;
};

type EvalRunReportSingleInput = {
  kind: "single";
  projectDir: string;
  frameworkVersion: string;
  datasetBase?: string;
  reportDir?: string;
  report?: string;
  junit?: string;
  baseline?: string;
  writeBaseline?: string;
  baselinePolicy?: EvalReportComparisonPolicy;
  exportRequired?: boolean;
  exportContext?: EvalReportExportConfig["context"];
  provenance?: EvalRunProvenance;
  evalItem: DiscoveredEval;
  targetKind: EvalReport["targetKind"];
  target: string;
  targetAdapter: unknown;
  selectedModel?: string;
  maxOutputTokens?: number;
};

type EvalRunReportInput = EvalRunReportSingleInput;

type EvalRunTargetOptions = {
  baseDir: string;
  runId: string;
  frameworkVersion: string;
  targetKind: EvalReport["targetKind"];
  target: string;
  targetAdapter: unknown;
  selectedModel?: string;
  maxOutputTokens?: number;
  metadata: EvalReport["metadata"];
};

type EvalRunReportTargetAdapters = {
  runEval(evalItem: DiscoveredEval, options: EvalRunTargetOptions): Promise<EvalReport>;
};

type EvalRunReportArtifactAdapters = {
  readTextFile(path: string): Promise<string>;
  writeTextFileEnsuringDir(path: string, content: string): Promise<void>;
};

type EvalRunReportBillingAdapters = {
  runWithGatewayBillingGroup(
    billingGroupId: string,
    operation: () => Promise<EvalReport>,
  ): Promise<EvalReport>;
};

type EvalRunReportExporterAdapters = {
  exportReport(report: EvalReport, config?: EvalReportExportConfig): Promise<EvalReport>;
};

type EvalRunReportClock = {
  now?: () => Date;
  createSuffix?: () => string;
};

type EvalRunReportAdapters = {
  targets: EvalRunReportTargetAdapters;
  artifacts: EvalRunReportArtifactAdapters;
  billing: EvalRunReportBillingAdapters;
  exporters: EvalRunReportExporterAdapters;
  clock?: EvalRunReportClock;
};

type EvalRunReportOutcome = {
  kind: "single";
  report: EvalReport;
  summary: CliEvalSummary;
  baseline?: EvalReportComparison;
  artifacts: EvalArtifactPaths;
  exitCode: 0 | 1;
  outputHints: EvalRunReportOutputHints;
};

function createEvalReportDirTimestamp(runId: string): string {
  return runId.startsWith("evalrun_") ? runId.slice("evalrun_".length) : runId;
}

function sanitizeEvalReportDirLabel(label: string): string {
  const normalized = label.startsWith("eval:") ? label.slice("eval:".length) : label;
  return normalized.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(
    /^[-._]+|[-._]+$/g,
    "",
  );
}

function createDefaultEvalReportDir(runId: string, label?: string): string {
  const timestamp = createEvalReportDirTimestamp(runId);
  const suffix = label ? sanitizeEvalReportDirLabel(label) : "";
  return join(".veryfront", "evals", suffix ? `${timestamp}-${suffix}` : timestamp);
}

function createEvalArtifactPaths(reportDir: string): EvalArtifactPaths {
  return {
    directory: reportDir,
    summary: join(reportDir, "summary.json"),
    results: join(reportDir, "results.jsonl"),
    reportMarkdown: join(reportDir, "report.md"),
  };
}

function sanitizeModelIdForPath(model: string): string {
  return model.trim().replace(/[^A-Za-z0-9._-]+/g, "__").replace(/^_+|_+$/g, "") || "model";
}

function summarizeReportForCli(report: EvalReport): CliEvalSummary {
  return {
    runId: report.runId,
    evalId: report.definitionId,
    target: report.target,
    records: report.summary.records,
    passed: report.summary.passed,
    failed: report.summary.failed,
    passRate: report.summary.passRate,
    metrics: report.summary.metrics,
  };
}

function createSummaryArtifact(
  report: EvalReport,
  baseline?: EvalReportComparison,
): EvalSummaryArtifact {
  return {
    kind: "eval-summary",
    schemaVersion: report.schemaVersion ?? EVAL_REPORT_SCHEMA_VERSION,
    runId: report.runId,
    definitionId: report.definitionId,
    targetKind: report.targetKind,
    target: report.target,
    ...(report.dataset ? { dataset: report.dataset } : {}),
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    summary: report.summary,
    ...(report.metadata ? { metadata: report.metadata } : {}),
    ...(report.exports ? { exports: report.exports } : {}),
    ...(baseline ? { baseline } : {}),
  };
}

function createResultsJsonl(report: EvalReport): string {
  if (report.records.length === 0) return "";
  return `${report.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function numberCell(value: number | undefined): string {
  return value === undefined ? "-" : String(Math.round(value));
}

function decimalCell(value: number | undefined): string {
  if (value === undefined) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function percentCell(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function durationCell(valueMs: number | undefined): string {
  return valueMs === undefined ? "-" : `${(valueMs / 1000).toFixed(3)}s`;
}

function usdCell(value: number | undefined): string {
  if (value === undefined) return "-";
  const absolute = Math.abs(value);
  if (absolute >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function usageRows(usage: EvalUsage | undefined): Array<[string, string]> {
  if (!usage) return [];
  const rows: Array<[string, string]> = [
    ["Input tokens", numberCell(usage.inputTokens)],
    ["Output tokens", numberCell(usage.outputTokens)],
    ["Total tokens", numberCell(usage.totalTokens)],
    ["Billable input tokens", numberCell(usage.billableInputTokens)],
    ["Billable output tokens", numberCell(usage.billableOutputTokens)],
    ["Provider input cost USD", usdCell(usage.providerInputCostUsd)],
    ["Provider output cost USD", usdCell(usage.providerOutputCostUsd)],
    ["Provider cost USD", usdCell(usage.providerCostUsd ?? usage.costUsd)],
    ["Veryfront input charge USD", usdCell(usage.veryfrontInputChargeUsd)],
    ["Veryfront output charge USD", usdCell(usage.veryfrontOutputChargeUsd)],
    ["Veryfront charge USD", usdCell(usage.veryfrontChargeUsd)],
    ["Veryfront billed USD", usdCell(usage.veryfrontBilledUsd)],
    ["Cost credits", decimalCell(usage.costCredits)],
    ["Cost source", usage.costSource ?? "-"],
    ["Billing mode", usage.billingMode ?? "-"],
    ["Usage capture status", usage.usageCaptureStatus ?? "-"],
  ];
  return rows.filter(([, value]) => value !== "-");
}

function isBlockingEvalResultFailure(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function examplePassed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return false;
  return [...(record.metrics ?? []), ...(record.checks ?? [])].every((result) =>
    !isBlockingEvalResultFailure(result)
  );
}

function createEvalMarkdownReport(
  report: EvalReport,
  baseline?: EvalReportComparison,
): string {
  const lines = [
    `# Eval report: ${markdownCell(report.definitionId)}`,
    "",
    `Run: \`${markdownCell(report.runId)}\``,
    `Target: \`${markdownCell(report.target)}\``,
    ...(report.metadata?.model ? [`Model: \`${markdownCell(report.metadata.model)}\``] : []),
    `Result: \`${report.summary.passed}/${report.summary.records} passed (${
      percentCell(report.summary.passRate)
    })\``,
    "",
    "## Metrics",
    "",
    "| Metric | Severity | Passed | Failed | Pass rate |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const metric of report.summary.metrics) {
    lines.push(
      `| \`${
        markdownCell(metric.name)
      }\` | ${metric.severity} | ${metric.passed} | ${metric.failed} | ${
        percentCell(metric.passRate)
      } |`,
    );
  }

  const rows = usageRows(report.summary.usage);
  if (rows.length > 0) {
    lines.push("", "## Usage", "", "| Usage | Value |", "| --- | ---: |");
    for (const [label, value] of rows) {
      lines.push(`| ${label} | ${value.startsWith("$") ? `\`${value}\`` : value} |`);
    }
  }

  lines.push(
    "",
    "## Examples",
    "",
    "| Example | Result | Duration | Tokens | Billed USD | Credits |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const record of report.records) {
    lines.push(
      `| \`${markdownCell(record.id)}\` | ${examplePassed(record) ? "PASS" : "FAIL"} | ${
        durationCell(record.durationMs)
      } | ${numberCell(record.usage.totalTokens)} | ${
        record.usage.veryfrontBilledUsd === undefined
          ? "-"
          : `\`${usdCell(record.usage.veryfrontBilledUsd)}\``
      } | ${decimalCell(record.usage.costCredits)} |`,
    );
  }

  if (baseline) {
    const direction = baseline.passRateDelta >= 0 ? "+" : "";
    lines.push(
      "",
      "## Baseline",
      "",
      `Status: \`${baseline.regressed ? "regressed" : "ok"}\``,
      `Pass rate delta: \`${direction}${Math.round(baseline.passRateDelta * 100)} pp\``,
    );
    if (baseline.newFailedExamples.length > 0) {
      lines.push(`New failed examples: ${baseline.newFailedExamples.map(markdownCell).join(", ")}`);
    }
  }

  if (report.exports?.length) {
    lines.push("", "## Exports", "");
    for (const result of report.exports) {
      lines.push(
        `- \`${markdownCell(result.exporterId)}\`: ${
          result.ok ? "ok" : `failed, ${markdownCell(result.error)}`
        }`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function blockingResults(record: EvalRecord): EvalMetricResult[] {
  return [...(record.metrics ?? []), ...(record.checks ?? [])].filter((result) =>
    !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget")
  );
}

function skippedResults(record: EvalRecord): EvalMetricResult[] {
  return [...(record.metrics ?? []), ...(record.checks ?? [])].filter((result) => result.skipped);
}

function testcaseName(record: EvalRecord): string {
  return `${record.exampleId}#${record.repetition}`;
}

function failureMessage(result: EvalMetricResult): string {
  return `${result.name} failed`;
}

function failureBody(result: EvalMetricResult): string {
  if (result.explanation) return result.explanation;
  if (result.evidence) return JSON.stringify(result.evidence);
  return failureMessage(result);
}

function createJunitXml(report: EvalReport): string {
  const skipped = report.records.reduce(
    (count, record) => count + skippedResults(record).length,
    0,
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${
      xmlEscape(report.definitionId)
    }" tests="${report.summary.records}" failures="${report.summary.failed}" skipped="${skipped}">`,
  ];

  for (const record of report.records) {
    const failures = blockingResults(record);
    const skips = skippedResults(record);
    const attrs = `classname="${xmlEscape(report.definitionId)}" name="${
      xmlEscape(testcaseName(record))
    }" time="${(record.durationMs / 1000).toFixed(3)}"`;

    if (failures.length === 0 && skips.length === 0) {
      lines.push(`  <testcase ${attrs} />`);
      continue;
    }

    lines.push(`  <testcase ${attrs}>`);
    for (const failure of failures) {
      lines.push(
        `    <failure message="${xmlEscape(failureMessage(failure))}">${
          xmlEscape(failureBody(failure))
        }</failure>`,
      );
    }
    for (const skip of skips) {
      lines.push(
        `    <skipped message="${xmlEscape(skip.explanation ?? `${skip.name} skipped`)}" />`,
      );
    }
    lines.push("  </testcase>");
  }

  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

async function writeEvalArtifacts(
  report: EvalReport,
  paths: EvalArtifactPaths,
  artifacts: EvalRunReportArtifactAdapters,
  baseline?: EvalReportComparison,
): Promise<void> {
  await artifacts.writeTextFileEnsuringDir(
    paths.summary,
    JSON.stringify(createSummaryArtifact(report, baseline), null, 2),
  );
  await artifacts.writeTextFileEnsuringDir(paths.results, createResultsJsonl(report));
  await artifacts.writeTextFileEnsuringDir(
    paths.reportMarkdown,
    createEvalMarkdownReport(report, baseline),
  );
}

function createEvalExitCode(
  report: EvalReport,
  baseline?: EvalReportComparison,
  exportRequired = false,
): 0 | 1 {
  const exportFailed = exportRequired &&
    (!(report.exports?.length) || report.exports.some((result) => !result.ok));
  return report.summary.failed === 0 && baseline?.regressed !== true && !exportFailed ? 0 : 1;
}

function createOutputHints(
  paths: EvalArtifactPaths,
  input: EvalRunReportSingleInput,
): EvalRunReportOutputHints {
  return {
    reportDirectory: paths.directory,
    reportMarkdown: paths.reportMarkdown,
    ...(input.report ? { report: input.report } : {}),
    ...(input.junit ? { junit: input.junit } : {}),
    ...(input.writeBaseline ? { baselineWritten: input.writeBaseline } : {}),
  };
}

function createRunId(clock: EvalRunReportClock | undefined): string {
  return createEvalRunId(clock?.now?.() ?? new Date(), clock?.createSuffix);
}

function createMetadata(input: EvalRunReportSingleInput): EvalReport["metadata"] {
  return {
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.selectedModel ? { model: input.selectedModel } : {}),
  };
}

async function readBaselineComparison(
  report: EvalReport,
  input: EvalRunReportSingleInput,
  artifacts: EvalRunReportArtifactAdapters,
): Promise<EvalReportComparison | undefined> {
  if (!input.baseline) return undefined;
  const baseline = JSON.parse(await artifacts.readTextFile(input.baseline)) as EvalReport;
  return compareEvalReports(report, baseline, input.baselinePolicy);
}

export async function runEvalReport(
  input: EvalRunReportInput,
  adapters: EvalRunReportAdapters,
): Promise<EvalRunReportOutcome> {
  const runId = createRunId(adapters.clock);
  const artifactPaths = createEvalArtifactPaths(
    input.reportDir ?? createDefaultEvalReportDir(runId, input.evalItem.id),
  );
  const billingGroupId = input.selectedModel
    ? `${runId}_${sanitizeModelIdForPath(input.selectedModel)}`
    : runId;
  const metadata = createMetadata(input);
  const finalizedReport = await adapters.billing.runWithGatewayBillingGroup(
    billingGroupId,
    () =>
      adapters.targets.runEval(input.evalItem, {
        baseDir: input.datasetBase ?? input.projectDir,
        runId,
        frameworkVersion: input.frameworkVersion,
        targetKind: input.targetKind,
        target: input.target,
        targetAdapter: input.targetAdapter,
        ...(input.selectedModel ? { selectedModel: input.selectedModel } : {}),
        ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
        metadata,
      }),
  );
  const report = await adapters.exporters.exportReport(finalizedReport, {
    required: input.exportRequired,
    context: {
      ...input.exportContext,
      evalId: input.evalItem.id,
      sourcePath: input.evalItem.filePath,
      reportPath: input.report ?? artifactPaths.summary,
    },
  });
  const baseline = await readBaselineComparison(report, input, adapters.artifacts);

  await writeEvalArtifacts(report, artifactPaths, adapters.artifacts, baseline);
  if (input.report) {
    await adapters.artifacts.writeTextFileEnsuringDir(
      input.report,
      JSON.stringify(report, null, 2),
    );
  }
  if (input.junit) {
    await adapters.artifacts.writeTextFileEnsuringDir(input.junit, createJunitXml(report));
  }
  if (input.writeBaseline) {
    await adapters.artifacts.writeTextFileEnsuringDir(
      input.writeBaseline,
      JSON.stringify(report, null, 2),
    );
  }

  return {
    kind: "single",
    report,
    summary: summarizeReportForCli(report),
    ...(baseline ? { baseline } : {}),
    artifacts: artifactPaths,
    exitCode: createEvalExitCode(report, baseline, input.exportRequired),
    outputHints: createOutputHints(artifactPaths, input),
  };
}
