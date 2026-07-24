import { join, relative } from "@std/path";
import { compareEvalReports } from "./baseline.ts";
import type { DiscoveredEval } from "./discovery.ts";
import { EVAL_REPORT_SCHEMA_VERSION } from "./report.ts";
import { createEvalRunId } from "./run-id.ts";
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
  children?: EvalRunReportChildOutputHint[];
};

type EvalRunReportChildOutputHint =
  | {
    kind: "report";
    evalId: string;
    reportDirectory: string;
    report: EvalReport;
  }
  | {
    kind: "error";
    evalId: string;
    error: string;
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
  exportConfig?: EvalReportExportConfig;
  provenance?: EvalRunProvenance;
  evalItem: DiscoveredEval;
  targetKind: EvalReport["targetKind"];
  target: string;
  targetAdapter: unknown;
  selectedModel?: string;
  maxOutputTokens?: number;
};

type EvalRunReportSuiteInput = {
  kind: "suite";
  projectDir: string;
  frameworkVersion: string;
  datasetBase?: string;
  reportDir?: string;
  junit?: string;
  exportConfig?: EvalReportExportConfig;
  provenance?: EvalRunProvenance;
  evalItems: DiscoveredEval[];
};

type EvalRunReportInput = EvalRunReportSingleInput | EvalRunReportSuiteInput;

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
  resolveTarget?(
    evalItem: DiscoveredEval,
  ):
    | Promise<Pick<EvalRunTargetOptions, "targetKind" | "target" | "targetAdapter">>
    | Pick<EvalRunTargetOptions, "targetKind" | "target" | "targetAdapter">;
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
} | {
  kind: "suite";
  suite: EvalSuiteSummary;
  artifacts: EvalSuiteArtifactPaths;
  exitCode: 0 | 1;
  outputHints: EvalRunReportOutputHints;
};

type EvalSuiteArtifactPaths = {
  directory: string;
  summary: string;
  results: string;
  reportMarkdown: string;
};

type EvalSuiteResult = {
  id: string;
  name: string;
  target: string;
  status: "passed" | "failed" | "error";
  artifacts?: EvalArtifactPaths;
  summary?: CliEvalSummary;
  error?: string;
};

type EvalSuiteSummary = {
  kind: "eval-suite-summary";
  runId: string;
  startedAt: string;
  endedAt: string;
  total: number;
  passed: number;
  failed: number;
  results: EvalSuiteResult[];
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

function createEvalSuiteArtifactPaths(reportDir: string): EvalSuiteArtifactPaths {
  return {
    directory: reportDir,
    summary: join(reportDir, "summary.json"),
    results: join(reportDir, "results.jsonl"),
    reportMarkdown: join(reportDir, "report.md"),
  };
}

function createEvalSuiteChildDirectory(
  suiteDirectory: string,
  index: number,
  evalId: string,
): string {
  return join(
    suiteDirectory,
    `${String(index + 1).padStart(3, "0")}-${sanitizeEvalReportDirLabel(evalId)}`,
  );
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

function sortEvals(evals: DiscoveredEval[]): DiscoveredEval[] {
  return [...evals].sort((left, right) =>
    left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath)
  );
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
    "| --- | --- | ---: | ---: | ---: |",
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

function createEvalSuiteResultsJsonl(summary: EvalSuiteSummary): string {
  if (summary.results.length === 0) return "";
  return `${summary.results.map((result) => JSON.stringify(result)).join("\n")}\n`;
}

function createEvalSuiteMarkdown(summary: EvalSuiteSummary): string {
  const rows = summary.results.map((result) =>
    `| ${markdownCell(result.id)} | ${result.status} | ${
      result.summary ? `${result.summary.passed}/${result.summary.records}` : "n/a"
    } | ${result.error ? markdownCell(result.error) : ""} |`
  );
  return [
    "# Eval suite report",
    "",
    `Run: \`${markdownCell(summary.runId)}\``,
    `Result: \`${summary.passed}/${summary.total} passed\``,
    "",
    "| Eval | Status | Records | Error |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function createEvalSuiteJunitXml(summary: EvalSuiteSummary): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${summary.total}" failures="${summary.failed}" skipped="0">`,
    `  <testsuite name="veryfront eval suite" tests="${summary.total}" failures="${summary.failed}" skipped="0">`,
  ];

  for (const result of summary.results) {
    const attrs = `classname="eval" name="${xmlEscape(result.id)}"`;
    if (result.status === "passed") {
      lines.push(`    <testcase ${attrs} />`);
      continue;
    }

    const message = result.error ??
      (result.summary?.failed
        ? `${result.summary.failed} record(s) failed`
        : "A required eval export failed.");
    lines.push(`    <testcase ${attrs}>`);
    lines.push(`      <failure message="${xmlEscape(message)}">${xmlEscape(message)}</failure>`);
    lines.push("    </testcase>");
  }

  lines.push("  </testsuite>");
  lines.push("</testsuites>");
  return `${lines.join("\n")}\n`;
}

async function writeEvalSuiteArtifacts(
  summary: EvalSuiteSummary,
  paths: EvalSuiteArtifactPaths,
  artifacts: EvalRunReportArtifactAdapters,
): Promise<void> {
  await artifacts.writeTextFileEnsuringDir(paths.summary, JSON.stringify(summary, null, 2));
  await artifacts.writeTextFileEnsuringDir(paths.results, createEvalSuiteResultsJsonl(summary));
  await artifacts.writeTextFileEnsuringDir(paths.reportMarkdown, createEvalSuiteMarkdown(summary));
}

function createEvalExitCode(
  report: EvalReport,
  baseline?: EvalReportComparison,
  exportIsRequired = false,
): 0 | 1 {
  const exportFailed = exportIsRequired &&
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

function createSuiteOutputHints(
  paths: EvalSuiteArtifactPaths,
  input: EvalRunReportSuiteInput,
  children: EvalRunReportChildOutputHint[],
): EvalRunReportOutputHints {
  return {
    reportDirectory: paths.directory,
    reportMarkdown: paths.reportMarkdown,
    ...(input.junit ? { junit: input.junit } : {}),
    children,
  };
}

function createRunId(clock: EvalRunReportClock | undefined): string {
  return createEvalRunId(clock?.now?.() ?? new Date(), clock?.createSuffix);
}

function stripFileProtocol(path: string): string {
  if (!path.startsWith("file://")) return path;
  return decodeURIComponent(new URL(path).pathname);
}

function displaySourcePath(filePath: string, projectDir: string): string {
  const normalized = stripFileProtocol(filePath);
  if (normalized.startsWith(projectDir)) {
    return relative(projectDir, normalized);
  }
  return normalized;
}

function createMetadata(
  input: EvalRunReportSingleInput | EvalRunReportSuiteInput,
): EvalReport["metadata"] {
  return {
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.kind === "single" && input.selectedModel ? { model: input.selectedModel } : {}),
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

function createEvalReportExportConfig(
  input: Pick<EvalRunReportSingleInput, "projectDir" | "report" | "exportConfig"> & {
    evalItem: DiscoveredEval;
  },
  artifactPaths: EvalArtifactPaths,
): EvalReportExportConfig | undefined {
  if (!input.exportConfig) return undefined;
  const tags = input.evalItem.definition.tags ?? [];
  const metadata = input.evalItem.definition.metadata ?? {};
  return {
    ...input.exportConfig,
    context: {
      evalId: input.evalItem.id,
      sourcePath: displaySourcePath(input.evalItem.filePath, input.projectDir),
      reportPath: input.report ?? artifactPaths.summary,
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      ...input.exportConfig.context,
    },
  };
}

function createEvalSuiteSummary(
  runId: string,
  startedAt: Date,
  endedAt: Date,
  results: EvalSuiteResult[],
): EvalSuiteSummary {
  const passed = results.filter((result) => result.status === "passed").length;
  return {
    kind: "eval-suite-summary",
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runEvalReportSuite(
  input: EvalRunReportSuiteInput,
  adapters: EvalRunReportAdapters,
): Promise<EvalRunReportOutcome> {
  const startedAt = adapters.clock?.now?.() ?? new Date();
  const runId = createEvalRunId(startedAt, adapters.clock?.createSuffix);
  const artifacts = createEvalSuiteArtifactPaths(
    input.reportDir ?? createDefaultEvalReportDir(runId),
  );
  const metadata = createMetadata(input);
  const results: EvalSuiteResult[] = [];
  const children: EvalRunReportChildOutputHint[] = [];

  for (const [index, evalItem] of sortEvals(input.evalItems).entries()) {
    const childRunId = `${runId}_${String(index + 1).padStart(3, "0")}`;
    const childArtifacts = createEvalArtifactPaths(
      createEvalSuiteChildDirectory(artifacts.directory, index, evalItem.id),
    );

    try {
      if (!adapters.targets.resolveTarget) {
        throw new Error("Suite eval target resolution is not configured.");
      }
      const target = await adapters.targets.resolveTarget(evalItem);
      const finalizedReport = await adapters.billing.runWithGatewayBillingGroup(
        childRunId,
        () =>
          adapters.targets.runEval(evalItem, {
            baseDir: input.datasetBase ?? input.projectDir,
            runId: childRunId,
            frameworkVersion: input.frameworkVersion,
            targetKind: target.targetKind,
            target: target.target,
            targetAdapter: target.targetAdapter,
            metadata,
          }),
      );
      const exportConfig = createEvalReportExportConfig(
        {
          projectDir: input.projectDir,
          evalItem,
          exportConfig: input.exportConfig,
        },
        childArtifacts,
      );
      const report = await adapters.exporters.exportReport(finalizedReport, exportConfig);
      await writeEvalArtifacts(report, childArtifacts, adapters.artifacts);
      const summary = summarizeReportForCli(report);
      const status = createEvalExitCode(report, undefined, exportConfig?.required) === 0
        ? "passed"
        : "failed";
      results.push({
        id: evalItem.id,
        name: evalItem.name,
        target: evalItem.definition.target,
        status,
        artifacts: childArtifacts,
        summary,
      });
      children.push({
        kind: "report",
        evalId: evalItem.id,
        reportDirectory: childArtifacts.directory,
        report,
      });
    } catch (error) {
      const message = errorMessage(error);
      results.push({
        id: evalItem.id,
        name: evalItem.name,
        target: evalItem.definition.target,
        status: "error",
        artifacts: childArtifacts,
        error: message,
      });
      children.push({
        kind: "error",
        evalId: evalItem.id,
        error: message,
      });
    }
  }

  const endedAt = adapters.clock?.now?.() ?? new Date();
  const suite = createEvalSuiteSummary(runId, startedAt, endedAt, results);
  await writeEvalSuiteArtifacts(suite, artifacts, adapters.artifacts);
  if (input.junit) {
    await adapters.artifacts.writeTextFileEnsuringDir(input.junit, createEvalSuiteJunitXml(suite));
  }

  return {
    kind: "suite",
    suite,
    artifacts,
    exitCode: suite.failed === 0 ? 0 : 1,
    outputHints: createSuiteOutputHints(artifacts, input, children),
  };
}

export async function runEvalReport(
  input: EvalRunReportInput,
  adapters: EvalRunReportAdapters,
): Promise<EvalRunReportOutcome> {
  if (input.kind === "suite") {
    return await runEvalReportSuite(input, adapters);
  }

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
  const exportConfig = createEvalReportExportConfig(input, artifactPaths);
  const report = await adapters.exporters.exportReport(finalizedReport, exportConfig);
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
    exitCode: createEvalExitCode(report, baseline, exportConfig?.required),
    outputHints: createOutputHints(artifactPaths, input),
  };
}
