/**
 * Eval command - Discover and run eval definitions from the evals/ directory.
 */

import { dirname, relative } from "@std/path";
import type { Agent, AgentResponse } from "veryfront/agent";
import type {
  DiscoveredEval,
  EvalAgentAdapterContext,
  EvalMetricResult,
  EvalRecord,
  EvalReport,
  EvalToolCall,
} from "veryfront/eval";
import { createProjectDiscoveryConfig, discoverAll } from "veryfront/discovery";
import { discoverEvals, runEval } from "veryfront/eval";
import { cliLogger, exitProcess } from "#cli/utils";
import {
  createErrorEnvelope,
  createSuccessEnvelope,
  isJsonMode,
  outputJson,
} from "../../shared/json-output.ts";
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

function resolveAgentTargetId(target: string): string {
  return target.startsWith("agent:") ? target.slice("agent:".length) : target;
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

function normalizeToolCalls(response: AgentResponse): EvalToolCall[] {
  return response.toolCalls.map((toolCall) => ({
    name: toolCall.name,
    status: toolCall.status === "error" ? "error" : "ok",
    ...(toolCall.error ? { error: toolCall.error } : {}),
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

function printReport(report: EvalReport): void {
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

  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
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
    const evalItem = evalDiscovery.evals.find((item) => item.id === evalId);
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

    const report = await runEval(evalItem.definition, {
      baseDir: options.datasetBase ?? projectDir,
      adapters: {
        agent: createAgentAdapter(agent, options),
      },
    });

    if (options.report) {
      await writeTextFileEnsuringDir(options.report, JSON.stringify(report, null, 2));
    }
    if (options.junit) {
      await writeTextFileEnsuringDir(options.junit, createJunitXml(report));
    }

    if (isJsonMode()) {
      await outputJson(createSuccessEnvelope("eval", {
        report,
        summary: summarizeReportForCli(report),
      }));
    } else {
      printReport(report);
      if (options.report) cliLogger.info(`Report: ${options.report}`);
      if (options.junit) cliLogger.info(`JUnit: ${options.junit}`);
    }

    exitProcess(report.summary.failed === 0 ? 0 : 1);
  });
}
