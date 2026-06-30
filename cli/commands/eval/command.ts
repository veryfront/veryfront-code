/**
 * Eval command - Discover and run eval definitions from the evals/ directory.
 */

import { dirname, isAbsolute, join, relative, resolve } from "@std/path";
import type { Agent, AgentResponse } from "veryfront/agent";
import type { VeryfrontConfig } from "veryfront/config";
import type {
  DiscoveredEval,
  EvalAgentAdapterContext,
  EvalMetricResult,
  EvalModelComparison,
  EvalModelComparisonMetricName,
  EvalModelComparisonOptions,
  EvalRecord,
  EvalReport,
  EvalReportComparison,
  EvalReportExportConfig,
  EvalToolCall,
  EvalUsage,
} from "veryfront/eval";
import { createProjectDiscoveryConfig, discoverAll } from "veryfront/discovery";
import {
  compareEvalModelReports,
  compareEvalReports,
  createEvalModelComparisonMarkdown,
  createEvalRunId,
  discoverEvals,
  exportEvalReport,
  resolveEvalRunProvenance,
  runEval,
} from "veryfront/eval";
import {
  getCurrentVeryfrontCloudContext,
  getVeryfrontCloudBootstrap,
  runWithVeryfrontCloudContextAsync,
} from "veryfront/provider";
import { applyRuntimeAuthContext } from "#cli/shared/runtime-auth";
import { cliLogger, exitProcess, VERSION } from "#cli/utils";
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

type EvalArtifactPaths = {
  directory: string;
  summary: string;
  results: string;
  reportMarkdown: string;
};

type EvalModelArtifactPaths = EvalArtifactPaths & {
  junit: string;
};

type EvalModelComparisonArtifactPaths = {
  directory: string;
  comparisonJson: string;
  comparisonMarkdown: string;
  models: Record<string, EvalModelArtifactPaths>;
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
  metadata?: EvalReport["metadata"];
  exports?: EvalReport["exports"];
  baseline?: EvalReportComparison;
};

type GatewayBillingGroupFinalization = {
  billing_group_id: string;
  charged_credits: number;
  target_credits: number;
  adjustment_credits: number;
  provider_cost_usd: number;
  veryfront_charge_usd: number;
  veryfront_billed_usd: number;
};

type GatewayBillingFinalizeError = {
  bodyText: string;
  code?: string;
};

type GatewayBillingFinalizeOptions = {
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
};

type EvalModelComparisonPolicy = Omit<EvalModelComparisonOptions, "baselineModel">;

const GATEWAY_BILLING_GROUP_USAGE_NOT_READY_CODE = "gateway_billing_group_usage_not_ready";
// Gateway usage capture is eventually consistent after model streams close.
const DEFAULT_GATEWAY_BILLING_FINALIZE_RETRY_DELAYS_MS = [
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  15_000,
] as const;

const MODEL_COMPARISON_METRICS = [
  "passRate",
  "failed",
  "gateFailures",
  "groundednessScore",
  "totalTokens",
  "costUsd",
  "p95Ms",
] as const satisfies readonly EvalModelComparisonMetricName[];

const MODEL_COMPARISON_METRIC_SET = new Set<string>(MODEL_COMPARISON_METRICS);
const MODEL_COMPARISON_OBJECTIVE_DIRECTIONS = new Set(["minimize", "maximize"]);

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

export function createDefaultEvalReportDir(runId: string, label?: string): string {
  const timestamp = createEvalReportDirTimestamp(runId);
  const suffix = label ? sanitizeEvalReportDirLabel(label) : "";
  return join(".veryfront", "evals", suffix ? `${timestamp}-${suffix}` : timestamp);
}

export function createEvalArtifactPaths(reportDir: string): EvalArtifactPaths {
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

export function createEvalModelArtifactPaths(
  reportDir: string,
  model: string,
): EvalModelArtifactPaths {
  const directory = join(reportDir, "models", sanitizeModelIdForPath(model));
  return {
    directory,
    summary: join(directory, "summary.json"),
    results: join(directory, "results.jsonl"),
    reportMarkdown: join(directory, "report.md"),
    junit: join(directory, "junit.xml"),
  };
}

function createEvalModelComparisonArtifactPaths(
  reportDir: string,
  models: string[],
): EvalModelComparisonArtifactPaths {
  return {
    directory: reportDir,
    comparisonJson: join(reportDir, "comparison.json"),
    comparisonMarkdown: join(reportDir, "comparison.md"),
    models: Object.fromEntries(
      models.map((model) => [model, createEvalModelArtifactPaths(reportDir, model)]),
    ),
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
    ...(report.metadata ? { metadata: report.metadata } : {}),
    ...(report.exports ? { exports: report.exports } : {}),
    ...(baseline ? { baseline } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  field: keyof GatewayBillingGroupFinalization,
): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseGatewayBillingGroupFinalization(
  payload: unknown,
): GatewayBillingGroupFinalization | undefined {
  if (!isRecord(payload) || typeof payload.billing_group_id !== "string") return undefined;
  const chargedCredits = readFiniteNumber(payload, "charged_credits");
  const targetCredits = readFiniteNumber(payload, "target_credits");
  const adjustmentCredits = readFiniteNumber(payload, "adjustment_credits");
  const providerCostUsd = readFiniteNumber(payload, "provider_cost_usd");
  const veryfrontChargeUsd = readFiniteNumber(payload, "veryfront_charge_usd");
  const veryfrontBilledUsd = readFiniteNumber(payload, "veryfront_billed_usd");

  if (
    chargedCredits === undefined ||
    targetCredits === undefined ||
    adjustmentCredits === undefined ||
    providerCostUsd === undefined ||
    veryfrontChargeUsd === undefined ||
    veryfrontBilledUsd === undefined
  ) {
    return undefined;
  }

  return {
    billing_group_id: payload.billing_group_id,
    charged_credits: chargedCredits,
    target_credits: targetCredits,
    adjustment_credits: adjustmentCredits,
    provider_cost_usd: providerCostUsd,
    veryfront_charge_usd: veryfrontChargeUsd,
    veryfront_billed_usd: veryfrontBilledUsd,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readGatewayBillingFinalizeError(
  response: Response,
): Promise<GatewayBillingFinalizeError> {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText) return { bodyText };

  try {
    const payload = JSON.parse(bodyText) as unknown;
    if (isRecord(payload) && typeof payload.code === "string") {
      return { bodyText, code: payload.code };
    }
  } catch {
    // Keep the raw body text for the warning below.
  }

  return { bodyText };
}

function isGatewayBillingUsageNotReady(
  response: Response,
  error: GatewayBillingFinalizeError,
): boolean {
  if (response.status !== 409) return false;
  return error.code === GATEWAY_BILLING_GROUP_USAGE_NOT_READY_CODE;
}

function formatGatewayBillingFinalizeWarning(
  billingGroupId: string,
  response: Response,
  error: GatewayBillingFinalizeError,
): string {
  const body = error.bodyText ? ` ${error.bodyText}` : "";
  return `Gateway billing finalization skipped for ${billingGroupId}: ${response.status}${body}`;
}

export function applyGatewayBillingGroupFinalization(
  report: EvalReport,
  finalization: GatewayBillingGroupFinalization,
): EvalReport {
  return {
    ...report,
    summary: {
      ...report.summary,
      usage: {
        ...(report.summary.usage ?? {}),
        providerCostUsd: finalization.provider_cost_usd,
        veryfrontChargeUsd: finalization.veryfront_charge_usd,
        veryfrontBilledUsd: finalization.veryfront_billed_usd,
        costCredits: finalization.target_credits,
        costSource: "gateway",
        billingMode: "direct",
        usageCaptureStatus: "complete",
      },
    },
  };
}

function hasGatewayUsage(report: EvalReport): boolean {
  const usage = report.summary.usage;
  return Boolean(
    usage?.costSource === "gateway" ||
      usage?.veryfrontChargeUsd !== undefined ||
      usage?.veryfrontBilledUsd !== undefined,
  );
}

export async function finalizeGatewayBillingGroup(
  billingGroupId: string,
  options: GatewayBillingFinalizeOptions = {},
): Promise<GatewayBillingGroupFinalization | undefined> {
  const bootstrap = getVeryfrontCloudBootstrap();
  if (!bootstrap.apiToken) return undefined;

  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_GATEWAY_BILLING_FINALIZE_RETRY_DELAYS_MS;
  const sleepFn = options.sleep ?? sleep;

  for (let attempt = 0;; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(joinApiUrl(bootstrap.apiBaseUrl, "ai/gateway/billing/finalize"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bootstrap.apiToken}`,
          "Content-Type": "application/json",
          ...(bootstrap.projectSlug ? { "x-veryfront-project-slug": bootstrap.projectSlug } : {}),
        },
        body: JSON.stringify({ billing_group_id: billingGroupId }),
      });
    } catch (error) {
      cliLogger.warn(
        `Gateway billing finalization skipped for ${billingGroupId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }

    if (!response.ok) {
      const error = await readGatewayBillingFinalizeError(response);
      const retryDelayMs = retryDelaysMs[attempt];
      if (isGatewayBillingUsageNotReady(response, error) && retryDelayMs !== undefined) {
        await sleepFn(retryDelayMs);
        continue;
      }

      cliLogger.warn(formatGatewayBillingFinalizeWarning(billingGroupId, response, error));
      return undefined;
    }

    const finalization = parseGatewayBillingGroupFinalization(await response.json());
    if (!finalization) {
      cliLogger.warn(
        `Gateway billing finalization skipped for ${billingGroupId}: invalid response`,
      );
    }
    return finalization;
  }
}

export async function runEvalWithGatewayBillingGroup(
  billingGroupId: string,
  operation: () => Promise<EvalReport>,
): Promise<EvalReport> {
  const currentContext = getCurrentVeryfrontCloudContext();
  const billingContext = { ...(currentContext ?? {}), billingGroupId };
  let report: EvalReport;
  try {
    report = await runWithVeryfrontCloudContextAsync(billingContext, operation);
  } catch (error) {
    if (billingContext.billingGroupUsed) {
      await finalizeGatewayBillingGroup(billingGroupId);
    }
    throw error;
  }
  if (!billingContext.billingGroupUsed && !hasGatewayUsage(report)) return report;
  const finalization = await finalizeGatewayBillingGroup(billingGroupId);
  return finalization ? applyGatewayBillingGroupFinalization(report, finalization) : report;
}

export async function exportEvalReportForCli(
  report: EvalReport,
  config?: EvalReportExportConfig,
): Promise<EvalReport> {
  const exports = await exportEvalReport(report, config);
  return exports === undefined ? report : { ...report, exports };
}

function readNumberField(
  record: Record<string, unknown>,
  field: string,
  path: string,
): number | undefined {
  const value = record[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid --comparison-policy: ${path}.${field} must be a finite number.`);
  }
  return value;
}

function assertKnownComparisonMetric(metric: string, path: string): EvalModelComparisonMetricName {
  if (MODEL_COMPARISON_METRIC_SET.has(metric)) return metric as EvalModelComparisonMetricName;
  throw new Error(`Invalid --comparison-policy: ${path} uses unknown metric "${metric}".`);
}

function parseComparisonConstraints(
  value: unknown,
): EvalModelComparisonPolicy["constraints"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("Invalid --comparison-policy: constraints must be an object.");
  }

  const constraints: NonNullable<EvalModelComparisonPolicy["constraints"]> = {};
  for (const [metricName, rawConstraint] of Object.entries(value)) {
    const metric = assertKnownComparisonMetric(metricName, `constraints.${metricName}`);
    if (!isRecord(rawConstraint)) {
      throw new Error(`Invalid --comparison-policy: constraints.${metricName} must be an object.`);
    }
    const maxRegressionPct = readNumberField(
      rawConstraint,
      "maxRegressionPct",
      `constraints.${metricName}`,
    );
    if (maxRegressionPct !== undefined && maxRegressionPct < 0) {
      throw new Error(
        `Invalid --comparison-policy: constraints.${metricName}.maxRegressionPct must be at least 0.`,
      );
    }
    constraints[metric] = {
      ...(rawConstraint.min !== undefined
        ? { min: readNumberField(rawConstraint, "min", `constraints.${metricName}`) }
        : {}),
      ...(rawConstraint.max !== undefined
        ? { max: readNumberField(rawConstraint, "max", `constraints.${metricName}`) }
        : {}),
      ...(maxRegressionPct !== undefined ? { maxRegressionPct } : {}),
    };
  }
  return constraints;
}

function parseComparisonObjectives(value: unknown): EvalModelComparisonPolicy["objectives"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("Invalid --comparison-policy: objectives must be an object.");
  }

  const objectives: NonNullable<EvalModelComparisonPolicy["objectives"]> = {};
  for (const [metricName, rawObjective] of Object.entries(value)) {
    const metric = assertKnownComparisonMetric(metricName, `objectives.${metricName}`);
    if (!isRecord(rawObjective)) {
      throw new Error(`Invalid --comparison-policy: objectives.${metricName} must be an object.`);
    }
    const weight = readNumberField(rawObjective, "weight", `objectives.${metricName}`);
    if (weight === undefined) {
      throw new Error(`Invalid --comparison-policy: objectives.${metricName}.weight is required.`);
    }
    if (weight <= 0) {
      throw new Error(
        `Invalid --comparison-policy: objectives.${metricName}.weight must be greater than 0.`,
      );
    }
    const direction = rawObjective.direction;
    if (
      typeof direction !== "string" || !MODEL_COMPARISON_OBJECTIVE_DIRECTIONS.has(direction)
    ) {
      throw new Error(
        `Invalid --comparison-policy: objectives.${metricName}.direction must be "minimize" or "maximize".`,
      );
    }
    objectives[metric] = {
      weight,
      direction: direction as "minimize" | "maximize",
    };
  }
  return objectives;
}

export async function loadEvalModelComparisonPolicy(
  projectDir: string,
  policyPath?: string,
): Promise<EvalModelComparisonPolicy> {
  if (!policyPath) return {};
  const resolvedPath = isAbsolute(policyPath) ? policyPath : resolve(projectDir, policyPath);
  let rawPolicy: string;
  try {
    rawPolicy = await Deno.readTextFile(resolvedPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("Invalid --comparison-policy: file not found.");
    }
    throw error;
  }

  let policy: unknown;
  try {
    policy = JSON.parse(rawPolicy) as unknown;
  } catch {
    throw new Error("Invalid --comparison-policy: file must contain valid JSON.");
  }
  if (!isRecord(policy)) {
    throw new Error("Invalid --comparison-policy: root value must be an object.");
  }
  return {
    ...("minGroundedness" in policy
      ? { minGroundedness: readNumberField(policy, "minGroundedness", "root") }
      : {}),
    ...("minCostImprovementPct" in policy
      ? { minCostImprovementPct: readNumberField(policy, "minCostImprovementPct", "root") }
      : {}),
    ...("minTokenImprovementPct" in policy
      ? { minTokenImprovementPct: readNumberField(policy, "minTokenImprovementPct", "root") }
      : {}),
    ...("minLatencyImprovementPct" in policy
      ? { minLatencyImprovementPct: readNumberField(policy, "minLatencyImprovementPct", "root") }
      : {}),
    ...(policy.constraints !== undefined
      ? { constraints: parseComparisonConstraints(policy.constraints) }
      : {}),
    ...(policy.objectives !== undefined
      ? { objectives: parseComparisonObjectives(policy.objectives) }
      : {}),
  };
}

export async function createResolvedEvalModelComparisonConfig(
  projectDir: string,
  options: EvalOptions,
): Promise<ResolvedEvalModelComparisonConfig | undefined> {
  const config = resolveEvalModelComparisonConfig(options);
  if (!config) return undefined;
  const policy = await loadEvalModelComparisonPolicy(projectDir, config.comparisonPolicy);
  return { config, policy };
}

export function createEvalModelComparisonArtifact(
  reports: EvalReport[],
  baselineModel: string,
  policy: EvalModelComparisonPolicy = {},
): EvalModelComparison {
  return compareEvalModelReports(reports, { ...policy, baselineModel });
}

export function createEvalModelComparisonExitCode(reports: EvalReport[]): 0 | 1 {
  return reports.some((report) => report.summary.failed > 0) ? 1 : 0;
}

export function createResultsJsonl(report: EvalReport): string {
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

/** Render a human-reviewable markdown report for a single eval run. */
export function createEvalMarkdownReport(
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
  await Deno.writeTextFile(paths.reportMarkdown, createEvalMarkdownReport(report, baseline));
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

export function normalizeUsage(response: AgentResponse) {
  return response.usage
    ? {
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      ...(response.usage.cachedInputTokens !== undefined
        ? { cachedInputTokens: response.usage.cachedInputTokens }
        : {}),
      ...(response.usage.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: response.usage.cacheCreationInputTokens }
        : {}),
      ...(response.usage.cacheReadInputTokens !== undefined
        ? { cacheReadInputTokens: response.usage.cacheReadInputTokens }
        : {}),
      ...(response.usage.reasoningTokens !== undefined
        ? { reasoningTokens: response.usage.reasoningTokens }
        : {}),
      ...(response.usage.billableInputTokens !== undefined
        ? { billableInputTokens: response.usage.billableInputTokens }
        : {}),
      ...(response.usage.billableOutputTokens !== undefined
        ? { billableOutputTokens: response.usage.billableOutputTokens }
        : {}),
      ...(response.usage.costUsd !== undefined ? { costUsd: response.usage.costUsd } : {}),
      ...(response.usage.providerInputCostUsd !== undefined
        ? { providerInputCostUsd: response.usage.providerInputCostUsd }
        : {}),
      ...(response.usage.providerOutputCostUsd !== undefined
        ? { providerOutputCostUsd: response.usage.providerOutputCostUsd }
        : {}),
      ...(response.usage.providerCostUsd !== undefined
        ? { providerCostUsd: response.usage.providerCostUsd }
        : {}),
      ...(response.usage.veryfrontInputChargeUsd !== undefined
        ? { veryfrontInputChargeUsd: response.usage.veryfrontInputChargeUsd }
        : {}),
      ...(response.usage.veryfrontOutputChargeUsd !== undefined
        ? { veryfrontOutputChargeUsd: response.usage.veryfrontOutputChargeUsd }
        : {}),
      ...(response.usage.veryfrontChargeUsd !== undefined
        ? { veryfrontChargeUsd: response.usage.veryfrontChargeUsd }
        : {}),
      ...(response.usage.veryfrontBilledUsd !== undefined
        ? { veryfrontBilledUsd: response.usage.veryfrontBilledUsd }
        : {}),
      ...(response.usage.costCredits !== undefined
        ? { costCredits: response.usage.costCredits }
        : {}),
      ...(response.usage.costSource !== undefined ? { costSource: response.usage.costSource } : {}),
      ...(response.usage.billingMode !== undefined
        ? { billingMode: response.usage.billingMode }
        : {}),
      ...(response.usage.usageCaptureStatus !== undefined
        ? { usageCaptureStatus: response.usage.usageCaptureStatus }
        : {}),
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

type EvalModelComparisonConfig = {
  baselineModel: string;
  candidateModels: string[];
  comparisonPolicy?: string;
  models: string[];
};

type ResolvedEvalModelComparisonConfig = {
  config: EvalModelComparisonConfig;
  policy: EvalModelComparisonPolicy;
};

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function resolveEvalModelComparisonConfig(
  options: EvalOptions,
): EvalModelComparisonConfig | undefined {
  const candidateModels = uniqueValues(options.candidateModels);
  const baselineModel = options.baselineModel?.trim();
  if (!baselineModel && candidateModels.length === 0) {
    if (options.comparisonPolicy) {
      throw new Error("--comparison-policy requires --baseline-model and --candidate-model.");
    }
    return undefined;
  }

  if (!baselineModel) {
    throw new Error("--baseline-model is required when using --candidate-model.");
  }
  if (candidateModels.length === 0) {
    throw new Error("--candidate-model is required when using --baseline-model.");
  }
  if (options.model) {
    throw new Error(
      "--model is for single eval runs. Use --baseline-model with --candidate-model for comparisons.",
    );
  }
  if (options.baseline || options.writeBaseline) {
    throw new Error(
      "--baseline and --write-baseline are for saved single-run reports, not model comparisons.",
    );
  }

  return {
    baselineModel,
    candidateModels: candidateModels.filter((model) => model !== baselineModel),
    ...(options.comparisonPolicy ? { comparisonPolicy: options.comparisonPolicy } : {}),
    models: uniqueValues([baselineModel, ...candidateModels]),
  };
}

function createAgentAdapterForModel(agent: Agent, options: EvalOptions, model: string) {
  return createAgentAdapter(agent, { ...options, model });
}

async function writeEvalModelComparisonArtifacts(
  comparison: EvalModelComparison,
  paths: EvalModelComparisonArtifactPaths,
): Promise<void> {
  await Deno.mkdir(paths.directory, { recursive: true });
  await Deno.writeTextFile(paths.comparisonJson, JSON.stringify(comparison, null, 2));
  await Deno.writeTextFile(paths.comparisonMarkdown, createEvalModelComparisonMarkdown(comparison));
}

async function runEvalModelComparison(input: {
  evalItem: DiscoveredEval;
  agent: Agent;
  options: EvalOptions;
  projectDir: string;
  config: EvalModelComparisonConfig;
  policy: EvalModelComparisonPolicy;
}): Promise<void> {
  const runId = createEvalRunId();
  const reportDir = input.options.reportDir ??
    createDefaultEvalReportDir(runId, input.evalItem.id);
  const paths = createEvalModelComparisonArtifactPaths(reportDir, input.config.models);
  const provenance = await resolveEvalRunProvenance({
    projectDir: input.projectDir,
    frameworkVersion: VERSION,
  });
  const reports: EvalReport[] = [];

  for (const model of input.config.models) {
    const modelPaths = paths.models[model]!;
    const modelOptions = { ...input.options, model, report: undefined };
    const modelRunId = `${runId}_${sanitizeModelIdForPath(model)}`;
    const exportConfig = createEvalCliExportConfig(
      input.evalItem,
      modelOptions,
      input.projectDir,
      modelPaths,
    );
    const finalizedReport = await runEvalWithGatewayBillingGroup(
      modelRunId,
      () =>
        runEval(input.evalItem.definition, {
          baseDir: input.options.datasetBase ?? input.projectDir,
          runId: modelRunId,
          adapters: {
            agent: createAgentAdapterForModel(input.agent, input.options, model),
          },
          metadata: {
            model,
            provenance,
          },
        }),
    );
    const report = await exportEvalReportForCli(finalizedReport, exportConfig);
    reports.push(report);
    await writeEvalArtifacts(report, modelPaths);
    await writeTextFileEnsuringDir(modelPaths.junit, createJunitXml(report));
  }

  const comparison = createEvalModelComparisonArtifact(
    reports,
    input.config.baselineModel,
    input.policy,
  );
  await writeEvalModelComparisonArtifacts(comparison, paths);
  if (input.options.report) {
    await writeTextFileEnsuringDir(input.options.report, JSON.stringify(comparison, null, 2));
  }

  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("eval", {
      reports,
      comparison,
      artifacts: paths,
    }));
  } else {
    for (const report of reports) {
      const model = report.metadata?.model ?? report.runId;
      cliLogger.info(`Model: ${model}`);
      printReport(report);
    }
    cliLogger.info(
      `Recommendation: ${comparison.recommendation.decision}${
        comparison.recommendation.model ? ` (${comparison.recommendation.model})` : ""
      }`,
    );
    for (const reason of comparison.recommendation.reasons) {
      cliLogger.info(`  - ${reason}`);
    }
    cliLogger.info(`Report directory: ${paths.directory}`);
    cliLogger.info(`Comparison: ${paths.comparisonJson}`);
    cliLogger.info(`Comparison markdown: ${paths.comparisonMarkdown}`);
    if (input.options.report) cliLogger.info(`Report: ${input.options.report}`);
  }

  exitProcess(createEvalModelComparisonExitCode(reports));
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

async function outputEvalUsageError(message: string): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createErrorEnvelope("eval", {
      code: "USAGE_ERROR",
      slug: "eval-usage-error",
      message,
    }));
  } else {
    cliLogger.error(message);
  }
  exitProcess(2);
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  const projectDir = Deno.cwd();

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

    let modelComparisonConfig: ResolvedEvalModelComparisonConfig | undefined;
    try {
      modelComparisonConfig = await createResolvedEvalModelComparisonConfig(projectDir, options);
    } catch (error) {
      await outputEvalUsageError(error instanceof Error ? error.message : String(error));
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

    if (modelComparisonConfig) {
      await runEvalModelComparison({
        evalItem,
        agent,
        options,
        projectDir,
        config: modelComparisonConfig.config,
        policy: modelComparisonConfig.policy,
      });
      return;
    }

    const runId = createEvalRunId();
    const artifactPaths = createEvalArtifactPaths(
      options.reportDir ?? createDefaultEvalReportDir(runId, evalItem.id),
    );
    const provenance = await resolveEvalRunProvenance({
      projectDir,
      frameworkVersion: VERSION,
    });
    const billingGroupId = options.model
      ? `${runId}_${sanitizeModelIdForPath(options.model)}`
      : runId;
    const exportConfig = createEvalCliExportConfig(evalItem, options, projectDir, artifactPaths);
    const finalizedReport = await runEvalWithGatewayBillingGroup(
      billingGroupId,
      () =>
        runEval(evalItem.definition, {
          baseDir: options.datasetBase ?? projectDir,
          runId,
          adapters: {
            agent: createAgentAdapter(agent, options),
          },
          metadata: {
            provenance,
            ...(options.model ? { model: options.model } : {}),
          },
        }),
    );
    const report = await exportEvalReportForCli(finalizedReport, exportConfig);

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
      cliLogger.info(`Report markdown: ${artifactPaths.reportMarkdown}`);
      if (options.report) cliLogger.info(`Report: ${options.report}`);
      if (options.junit) cliLogger.info(`JUnit: ${options.junit}`);
      if (options.writeBaseline) cliLogger.info(`Baseline written: ${options.writeBaseline}`);
    }

    exitProcess(createEvalExitCode(report, baseline));
  });
}
