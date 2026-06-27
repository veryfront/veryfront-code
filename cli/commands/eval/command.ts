/**
 * Eval command - Discover and run eval definitions from the evals/ directory.
 */

import { dirname, join, relative } from "@std/path";
import type { Agent, AgentResponse } from "veryfront/agent";
import type { VeryfrontConfig } from "veryfront/config";
import type {
  DiscoveredEval,
  EvalAgentAdapterContext,
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  EvalReportComparison,
  EvalReportExportConfig,
  EvalToolCall,
} from "veryfront/eval";
import { createProjectDiscoveryConfig, discoverAll } from "veryfront/discovery";
import { compareEvalReports, discoverEvals, runEval } from "veryfront/eval";
import { applyRuntimeAuthContext } from "#cli/shared/runtime-auth";
import { cliLogger, exitProcess } from "#cli/utils";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
import { readConfigFile } from "../../shared/config.ts";
import { withProjectSourceContext } from "../../shared/project-source-context.ts";
import type { EvalArgs } from "./handler.ts";

export interface EvalOptions extends EvalArgs {}

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
};

type EvalSummaryArtifact = {
  kind: "eval-summary";
  runId: string;
  definitionId: string;
  targetKind: EvalReport["targetKind"];
  target: string;
  startedAt: string;
  endedAt: string;
  summary: EvalReport["summary"];
  exports?: EvalReport["exports"];
  baseline?: EvalReportComparison;
};

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripFileProtocol(path: string): string {
  if (!path.startsWith("file://")) return path;
  return decodeURIComponent(new URL(path).pathname);
}

function createCliRunId(now = new Date()): string {
  return `evalrun_${now.toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "")}`;
}

export function createDefaultEvalReportDir(runId: string): string {
  return join(".veryfront", "evals", runId);
}

export function createEvalArtifactPaths(reportDir: string): EvalArtifactPaths {
  return {
    directory: reportDir,
    summary: join(reportDir, "summary.json"),
    results: join(reportDir, "results.jsonl"),
  };
}

function displaySourcePath(filePath: string, projectDir: string): string {
  const normalized = stripFileProtocol(filePath);
  if (normalized.startsWith(projectDir)) {
    return relative(projectDir, normalized);
  }
  return normalized;
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

export function normalizeEvalCliId(id: string): string {
  return id.startsWith("eval:") ? id : `eval:${id}`;
}

function createEvalCliIdCandidates(id: string): string[] {
  const normalized = normalizeEvalCliId(id);
  const bare = normalized.startsWith("eval:") ? normalized.slice("eval:".length) : normalized;
  return Array.from(new Set([id, normalized, bare]));
}

export function findEvalForCliId(evals: DiscoveredEval[], id: string): DiscoveredEval | undefined {
  const candidates = createEvalCliIdCandidates(id);
  return candidates
    .map((candidate) => evals.find((item) => item.id === candidate))
    .find((item) => item !== undefined);
}

export function normalizeEvalInputForAgent(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const key of ["prompt", "question", "input"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return JSON.stringify(input);
}

export function summarizeReportForCli(report: EvalReport): CliEvalSummary {
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

export function createSummaryArtifact(
  report: EvalReport,
  baseline?: EvalReportComparison,
): EvalSummaryArtifact {
  return {
    kind: "eval-summary",
    runId: report.runId,
    definitionId: report.definitionId,
    targetKind: report.targetKind,
    target: report.target,
    startedAt: report.startedAt,
    endedAt: report.endedAt,
    summary: report.summary,
    ...(report.exports ? { exports: report.exports } : {}),
    ...(baseline ? { baseline } : {}),
  };
}

export function createResultsJsonl(report: EvalReport): string {
  if (report.records.length === 0) return "";
  return `${report.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function createJunitXml(report: EvalReport): string {
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

async function writeTextFileEnsuringDir(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  if (dir && dir !== ".") await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, content);
}

export async function writeEvalArtifacts(
  report: EvalReport,
  paths: EvalArtifactPaths,
  baseline?: EvalReportComparison,
): Promise<void> {
  await Deno.mkdir(paths.directory, { recursive: true });
  await Deno.writeTextFile(
    paths.summary,
    JSON.stringify(createSummaryArtifact(report, baseline), null, 2),
  );
  await Deno.writeTextFile(paths.results, createResultsJsonl(report));
}

async function readEvalReport(path: string): Promise<EvalReport> {
  return JSON.parse(await Deno.readTextFile(path)) as EvalReport;
}

export function createEvalExitCode(
  report: EvalReport,
  baseline?: EvalReportComparison,
): 0 | 1 {
  return report.summary.failed === 0 && baseline?.regressed !== true ? 0 : 1;
}

function resolveAgentTargetId(target: string): string {
  return target.startsWith("agent:") ? target.slice("agent:".length) : target;
}

type EvalRuntimeAuthConfig = Pick<VeryfrontConfig, "projectSlug" | "fs"> & {
  projectSlug?: string;
};

function resolveEvalRuntimeProjectSlug(
  config: EvalRuntimeAuthConfig | null | undefined,
): string | undefined {
  return config?.projectSlug ?? config?.fs?.veryfront?.projectSlug;
}

export async function hydrateEvalRuntimeAuth(
  projectDir: string,
  config: EvalRuntimeAuthConfig | null | undefined,
) {
  return await applyRuntimeAuthContext({
    projectDir,
    projectSlug: resolveEvalRuntimeProjectSlug(config),
  });
}

function normalizeUsage(response: AgentResponse) {
  return response.usage
    ? {
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
    }
    : {};
}

export function normalizeToolCalls(response: AgentResponse): EvalToolCall[] {
  return response.toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status === "error" ? "error" : "ok",
    input: toolCall.args,
    ...(Object.hasOwn(toolCall, "result") ? { output: toolCall.result } : {}),
    ...(toolCall.error ? { error: toolCall.error } : {}),
    ...(toolCall.executionTime !== undefined
      ? { metadata: { executionTime: toolCall.executionTime } }
      : {}),
  }));
}

function createAgentAdapter(agent: Agent, options: EvalOptions) {
  return async ({ example }: EvalAgentAdapterContext) => {
    const started = Date.now();
    const response = await agent.generate({
      input: normalizeEvalInputForAgent(example.input),
      ...(options.model ? { model: options.model } : {}),
      ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    });
    return {
      text: response.text,
      trace: {
        events: response.messages,
        toolCalls: normalizeToolCalls(response),
      },
      usage: normalizeUsage(response),
      durationMs: Date.now() - started,
      completed: response.status === "completed",
      ...(response.status === "error" ? { error: response.text } : {}),
    };
  };
}

function listEvals(evals: DiscoveredEval[], projectDir: string) {
  return evals.map((item) => ({
    id: item.id,
    name: item.name,
    target: item.definition.target,
    source: {
      filePath: displaySourcePath(item.filePath, projectDir),
      exportName: item.exportName,
    },
  }));
}

function printReport(report: EvalReport, baseline?: EvalReportComparison): void {
  cliLogger.info(`Eval ${report.definitionId}`);
  cliLogger.info(`Target: ${report.target}`);
  cliLogger.info(
    `Result: ${report.summary.passed}/${report.summary.records} passed (${
      Math.round(report.summary.passRate * 100)
    }%)`,
  );

  for (const metric of report.summary.metrics) {
    cliLogger.info(
      `  ${metric.name}: ${metric.passed}/${metric.passed + metric.failed} passed (${
        Math.round(metric.passRate * 100)
      }%)`,
    );
  }

  for (const result of report.exports ?? []) {
    if (result.ok) {
      cliLogger.info(`Export ${result.exporterId}: ok`);
    } else {
      cliLogger.warn(`Export ${result.exporterId}: failed: ${result.error}`);
    }
  }

  if (baseline) {
    const direction = baseline.passRateDelta >= 0 ? "+" : "";
    cliLogger.info(
      `Baseline: ${baseline.regressed ? "regressed" : "ok"} (${direction}${
        Math.round(baseline.passRateDelta * 100)
      } pp pass rate)`,
    );
    if (baseline.newFailedExamples.length > 0) {
      cliLogger.warn(`New failed examples: ${baseline.newFailedExamples.join(", ")}`);
    }
  }
}

function createEvalCliExportConfig(
  evalItem: DiscoveredEval,
  options: EvalOptions,
  projectDir: string,
  artifactPaths: EvalArtifactPaths,
): EvalReportExportConfig | undefined {
  if (options.exporters.length === 0) return undefined;

  return {
    exporterIds: options.exporters,
    context: {
      evalId: evalItem.definition.id,
      sourcePath: displaySourcePath(evalItem.filePath, projectDir),
      reportPath: options.report ?? artifactPaths.summary,
      tags: evalItem.definition.tags,
      metadata: evalItem.definition.metadata,
      redaction: {},
    },
  };
}

async function outputEvalNotFound(id: string, evals: DiscoveredEval[]): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createErrorEnvelope("eval", {
      code: "NOT_FOUND",
      slug: "eval-not-found",
      message: `Eval "${id}" not found`,
      context: { available: evals.map((item) => item.id) },
    }));
  } else {
    cliLogger.error(`Eval "${id}" not found.`);
    if (evals.length > 0) {
      cliLogger.info("Available evals:");
      for (const item of evals) cliLogger.info(`  - ${item.id}`);
    } else {
      cliLogger.info("No evals found. Create an eval file in evals/.");
    }
  }
  exitProcess(1);
}

async function outputAgentNotFound(agentId: string): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createErrorEnvelope("eval", {
      code: "NOT_FOUND",
      slug: "eval-agent-not-found",
      message: `Agent "${agentId}" not found`,
    }));
  } else {
    cliLogger.error(`Agent "${agentId}" not found for eval target.`);
  }
  exitProcess(1);
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  const projectDir = Deno.cwd();
  const configFile = await readConfigFile(projectDir);

  if (configFile?.projectSlug) {
    await hydrateEvalRuntimeAuth(projectDir, configFile);
  }

  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
    await hydrateEvalRuntimeAuth(projectDir, config);

    const evalDiscovery = await discoverEvals({ projectDir, adapter, config });

    if (options.debug) {
      for (const error of evalDiscovery.errors) {
        cliLogger.warn(`Eval discovery warning: ${error.filePath}: ${error.error}`);
      }
    }

    if (options.list) {
      const evals = listEvals(evalDiscovery.evals, projectDir);
      if (isJsonMode()) {
        await outputJson(createSuccessEnvelope("eval", { evals, errors: evalDiscovery.errors }));
        return;
      }

      if (evals.length === 0) {
        cliLogger.info("No evals found.");
        return;
      }

      cliLogger.info("Evals:");
      for (const item of evals) {
        cliLogger.info(`  - ${item.id} (${item.target})`);
      }
      return;
    }

    if (!options.id) {
      if (isJsonMode()) {
        await outputJson(createErrorEnvelope("eval", {
          code: "USAGE_ERROR",
          slug: "eval-id-required",
          message: "Eval id is required",
        }));
      } else {
        cliLogger.error("Eval id is required. Usage: veryfront eval <eval-id>");
      }
      exitProcess(2);
      return;
    }

    const evalId = normalizeEvalCliId(options.id);
    const evalItem = findEvalForCliId(evalDiscovery.evals, options.id);
    if (!evalItem) {
      await outputEvalNotFound(evalId, evalDiscovery.evals);
      return;
    }

    const discoveryConfig = createProjectDiscoveryConfig({
      projectDir,
      config,
      fsAdapter: adapter.fs,
      verbose: options.debug,
    });
    const projectDiscovery = await discoverAll(discoveryConfig);
    const agentId = resolveAgentTargetId(evalItem.definition.target);
    const agent = projectDiscovery.agents.get(agentId);
    if (!agent) {
      await outputAgentNotFound(agentId);
      return;
    }

    const runId = createCliRunId();
    const artifactPaths = createEvalArtifactPaths(
      options.reportDir ?? createDefaultEvalReportDir(runId),
    );
    const report = await runEval(evalItem.definition, {
      baseDir: options.datasetBase ?? projectDir,
      runId,
      adapters: {
        agent: createAgentAdapter(agent, options),
      },
      export: createEvalCliExportConfig(evalItem, options, projectDir, artifactPaths),
    });

    const baseline = options.baseline
      ? compareEvalReports(report, await readEvalReport(options.baseline))
      : undefined;

    await writeEvalArtifacts(report, artifactPaths, baseline);
    if (options.report) {
      await writeTextFileEnsuringDir(options.report, JSON.stringify(report, null, 2));
    }
    if (options.junit) {
      await writeTextFileEnsuringDir(options.junit, createJunitXml(report));
    }
    if (options.writeBaseline) {
      await writeTextFileEnsuringDir(options.writeBaseline, JSON.stringify(report, null, 2));
    }

    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("eval", {
        report,
        summary: summarizeReportForCli(report),
        baseline,
        artifacts: artifactPaths,
      }));
    } else {
      printReport(report, baseline);
      cliLogger.info(`Report directory: ${artifactPaths.directory}`);
      if (options.report) cliLogger.info(`Report: ${options.report}`);
      if (options.junit) cliLogger.info(`JUnit: ${options.junit}`);
      if (options.writeBaseline) cliLogger.info(`Baseline written: ${options.writeBaseline}`);
    }

    exitProcess(createEvalExitCode(report, baseline));
  });
}
