/**
 * ext-eval-report-mlflow: MLflow Tracking transport for eval report exports.
 *
 * The extension resolves the core `EvalReportExporterRegistry` contract during
 * setup and registers one `EvalReportExporter` that writes a completed
 * Veryfront `EvalReport` to MLflow as a run.
 *
 * @module extensions/ext-eval-report-mlflow
 */

import type { EvalReport } from "veryfront/eval";
import type { ExtensionFactory } from "veryfront/extensions";
import {
  type EvalReportExportContext,
  type EvalReportExporter,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
  type EvalReportExportReceipt,
} from "veryfront/extensions/eval";

const DEFAULT_EXPORTER_ID = "mlflow";
const ENV_TRACKING_URI = "MLFLOW_TRACKING_URI";
const ENV_EXPERIMENT_NAME = "MLFLOW_EXPERIMENT_NAME";
const ENV_RUN_NAME = "MLFLOW_RUN_NAME";
const ENV_ARTIFACTS_URI = "MLFLOW_ARTIFACTS_URI";
const ENV_TRACKING_TOKEN = "MLFLOW_TRACKING_TOKEN";
const ENV_TRACKING_USERNAME = "MLFLOW_TRACKING_USERNAME";
const ENV_TRACKING_PASSWORD = "MLFLOW_TRACKING_PASSWORD";

const EXTENSION_METADATA = {
  contracts: {
    requires: ["EvalReportExporterRegistry"],
  },
  capabilities: [
    { type: "net:outbound", hosts: ["*"] },
    {
      type: "env:read",
      keys: [
        "MLFLOW_ARTIFACTS_URI",
        "MLFLOW_EXPERIMENT_NAME",
        "MLFLOW_RUN_NAME",
        "MLFLOW_TRACKING_PASSWORD",
        "MLFLOW_TRACKING_TOKEN",
        "MLFLOW_TRACKING_URI",
        "MLFLOW_TRACKING_USERNAME",
      ],
    },
  ],
};

type EvalReportMlflowFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface MlflowMetric {
  key: string;
  value: number;
  timestamp: number;
  step: number;
}

interface MlflowTag {
  key: string;
  value: string;
}

interface MlflowParam {
  key: string;
  value: string;
}

const MLFLOW_LOG_BATCH_MAX_TOTAL_ENTRIES = 1000;
const MLFLOW_LOG_BATCH_MAX_METRICS = 1000;
const MLFLOW_LOG_BATCH_MAX_PARAMS = 100;
const MLFLOW_LOG_BATCH_MAX_TAGS = 100;
const MLFLOW_LOG_BATCH_MAX_BYTES = 950_000;
const LOG_BATCH_BODY_ENCODER = new TextEncoder();
const MLFLOW_KEY_MAX_LENGTH = 250;
const MLFLOW_PARAM_VALUE_MAX_LENGTH = 6_000;
const MLFLOW_TAG_VALUE_MAX_LENGTH = 5_000;
const SUPPORTED_MLFLOW_PROXY_ARTIFACT_URI_SCHEMES = [
  "mlflow-artifacts:/",
  "s3://",
] as const;

interface ClassificationRow {
  expected: string;
  predicted: string;
  correct: boolean;
  confidence?: number;
}

interface ClassificationMetricSet {
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalReportMlflowExtensionConfig {
  trackingUri?: string;
  artifactsUri?: string;
  experimentName?: string;
  runName?: string;
  trackingToken?: string;
  trackingUsername?: string;
  trackingPassword?: string;
  fetch?: EvalReportMlflowFetch;
}

export interface MlflowArtifactUploadResult {
  artifactPath: string;
  uploadUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEnv(name: string): string | undefined {
  try {
    const value = Deno.env.get(name);
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeConfig(config: unknown): EvalReportMlflowExtensionConfig {
  if (!isRecord(config)) return {};
  return {
    ...(typeof config.trackingUri === "string" ? { trackingUri: config.trackingUri } : {}),
    ...(typeof config.artifactsUri === "string" ? { artifactsUri: config.artifactsUri } : {}),
    ...(typeof config.experimentName === "string" ? { experimentName: config.experimentName } : {}),
    ...(typeof config.runName === "string" ? { runName: config.runName } : {}),
    ...(typeof config.trackingToken === "string" ? { trackingToken: config.trackingToken } : {}),
    ...(typeof config.trackingUsername === "string"
      ? { trackingUsername: config.trackingUsername }
      : {}),
    ...(typeof config.trackingPassword === "string"
      ? { trackingPassword: config.trackingPassword }
      : {}),
    ...(typeof config.fetch === "function" ? { fetch: config.fetch as EvalReportMlflowFetch } : {}),
  };
}

function normalizeHttpUri(uri: string, label: string): string {
  const trimmed = uri.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) {
      throw new Error(
        `MLflow ${label} must not include credentials. Use MLFLOW_TRACKING_TOKEN or MLFLOW_TRACKING_USERNAME/MLFLOW_TRACKING_PASSWORD instead.`,
      );
    }
    if (url.protocol === "http:" || url.protocol === "https:") return trimmed;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not include credentials")) {
      throw error;
    }
    // Use the consistent message below.
  }
  throw new Error(`MLflow ${label} must be an HTTP(S) URI: ${uri}`);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function truncateWithHash(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const suffix = `_${stableHash(value)}`;
  return `${value.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}

function normalizeMlflowKey(key: string): string {
  return truncateWithHash(key.trim() || "veryfront", MLFLOW_KEY_MAX_LENGTH);
}

function normalizeMlflowParamValue(value: string): string {
  return truncateWithHash(value, MLFLOW_PARAM_VALUE_MAX_LENGTH);
}

function normalizeMlflowTagValue(value: string): string {
  return truncateWithHash(value, MLFLOW_TAG_VALUE_MAX_LENGTH);
}

function createTrackingAuthHeaders(
  config: Pick<
    EvalReportMlflowExtensionConfig,
    "trackingPassword" | "trackingToken" | "trackingUsername"
  >,
): Record<string, string> {
  if (config.trackingToken) {
    return { authorization: `Bearer ${config.trackingToken}` };
  }
  if (config.trackingUsername || config.trackingPassword) {
    const credentials = btoa(`${config.trackingUsername ?? ""}:${config.trackingPassword ?? ""}`);
    return { authorization: `Basic ${credentials}` };
  }
  return {};
}

function resolveExporterConfig(
  config: EvalReportMlflowExtensionConfig,
): EvalReportMlflowExtensionConfig & { id: string } {
  return {
    id: DEFAULT_EXPORTER_ID,
    trackingUri: config.trackingUri ?? readEnv(ENV_TRACKING_URI),
    artifactsUri: config.artifactsUri ?? readEnv(ENV_ARTIFACTS_URI),
    experimentName: config.experimentName ?? readEnv(ENV_EXPERIMENT_NAME),
    runName: config.runName ?? readEnv(ENV_RUN_NAME),
    trackingToken: config.trackingToken ?? readEnv(ENV_TRACKING_TOKEN),
    trackingUsername: config.trackingUsername ?? readEnv(ENV_TRACKING_USERNAME),
    trackingPassword: config.trackingPassword ?? readEnv(ENV_TRACKING_PASSWORD),
    ...(config.fetch ? { fetch: config.fetch } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function tag(key: string, value: unknown): MlflowTag | undefined {
  const next = stringValue(value);
  return next === undefined
    ? undefined
    : { key: normalizeMlflowKey(key), value: normalizeMlflowTagValue(next) };
}

function param(key: string, value: unknown): MlflowParam | undefined {
  const next = stringValue(value);
  return next === undefined
    ? undefined
    : { key: normalizeMlflowKey(key), value: normalizeMlflowParamValue(next) };
}

function compact<T>(values: Array<T | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined);
}

function reportModel(report: EvalReport): string | undefined {
  return typeof report.metadata?.model === "string" ? report.metadata.model : undefined;
}

function reportProvenanceGit(
  report: EvalReport,
): { sha?: string; branch?: string } {
  const provenance = report.metadata?.provenance;
  if (!provenance || typeof provenance !== "object") return {};
  const git = (provenance as { git?: unknown }).git;
  if (!isRecord(git)) return {};
  return {
    ...(typeof git.sha === "string" ? { sha: git.sha } : {}),
    ...(typeof git.branch === "string" ? { branch: git.branch } : {}),
  };
}

function experimentName(
  config: EvalReportMlflowExtensionConfig,
  report: EvalReport,
  context: EvalReportExportContext,
): string {
  return config.experimentName ??
    context.projectReference ??
    context.projectId ??
    report.definitionId ??
    "veryfront-evals";
}

function runName(
  config: EvalReportMlflowExtensionConfig,
  report: EvalReport,
): string {
  return config.runName ?? `${report.definitionId}-${report.runId}`;
}

function createRunTags(
  config: EvalReportMlflowExtensionConfig,
  report: EvalReport,
  context: EvalReportExportContext,
): MlflowTag[] {
  const git = reportProvenanceGit(report);
  return compact([
    tag("mlflow.runName", runName(config, report)),
    tag("eval.framework", "veryfront"),
    tag("eval.definition_id", report.definitionId),
    tag("eval.target", report.target),
    tag("eval.target_kind", report.targetKind),
    tag("eval.run_id", report.runId),
    tag("eval.status", report.summary.failed === 0 ? "passed" : "failed"),
    tag("eval.source_path", context.sourcePath),
    tag("eval.report_path", context.reportPath),
    tag("eval.environment", context.environment),
    tag("eval.branch", context.branch ?? git.branch),
    tag("eval.commit_sha", context.commitSha ?? git.sha),
    tag("eval.run_url", context.runUrl),
    tag("eval.tags", context.tags?.join(",")),
    tag("eval.model", reportModel(report)),
    tag("trace.id", context.trace?.traceId),
    tag("trace.span_id", context.trace?.spanId),
  ]);
}

function createRunParams(
  report: EvalReport,
  context: EvalReportExportContext,
): MlflowParam[] {
  return compact([
    param("framework_eval_id", report.definitionId),
    param("framework_run_id", report.runId),
    param("framework_target", report.target),
    param("framework_target_kind", report.targetKind),
    param("source_path", context.sourcePath),
    param("report_path", context.reportPath),
    param("model", reportModel(report)),
  ]);
}

function mlflowMetric(
  key: string,
  value: number | undefined,
  timestamp: number,
): MlflowMetric | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return { key: normalizeMlflowKey(key), value, timestamp, step: 0 };
}

function durationMetrics(
  duration: NonNullable<EvalReport["summary"]["duration"]> | undefined,
  timestamp: number,
): MlflowMetric[] {
  if (!duration) return [];
  return compact([
    mlflowMetric("duration_ms_total", duration.totalMs, timestamp),
    mlflowMetric("duration_ms_min", duration.minMs, timestamp),
    mlflowMetric("duration_ms_max", duration.maxMs, timestamp),
    mlflowMetric("duration_ms_mean", duration.meanMs, timestamp),
    mlflowMetric("duration_ms_p50", duration.p50Ms, timestamp),
    mlflowMetric("duration_ms_p95", duration.p95Ms, timestamp),
    mlflowMetric("duration_seconds_total", duration.totalMs / 1000, timestamp),
    mlflowMetric("duration_seconds_mean", duration.meanMs / 1000, timestamp),
    mlflowMetric("duration_seconds_p95", duration.p95Ms / 1000, timestamp),
  ]);
}

function usageMetrics(
  usage: NonNullable<EvalReport["summary"]["usage"]> | undefined,
  timestamp: number,
): MlflowMetric[] {
  if (!usage) return [];
  return compact([
    mlflowMetric("input_tokens", usage.inputTokens, timestamp),
    mlflowMetric("output_tokens", usage.outputTokens, timestamp),
    mlflowMetric("total_tokens", usage.totalTokens, timestamp),
    mlflowMetric("billable_input_tokens", usage.billableInputTokens, timestamp),
    mlflowMetric(
      "billable_output_tokens",
      usage.billableOutputTokens,
      timestamp,
    ),
    mlflowMetric("cached_input_tokens", usage.cachedInputTokens, timestamp),
    mlflowMetric(
      "cache_creation_input_tokens",
      usage.cacheCreationInputTokens,
      timestamp,
    ),
    mlflowMetric(
      "cache_read_input_tokens",
      usage.cacheReadInputTokens,
      timestamp,
    ),
    mlflowMetric("reasoning_tokens", usage.reasoningTokens, timestamp),
    mlflowMetric("cost_usd", usage.costUsd, timestamp),
    mlflowMetric(
      "provider_input_cost_usd",
      usage.providerInputCostUsd,
      timestamp,
    ),
    mlflowMetric(
      "provider_output_cost_usd",
      usage.providerOutputCostUsd,
      timestamp,
    ),
    mlflowMetric("provider_cost_usd", usage.providerCostUsd, timestamp),
    mlflowMetric(
      "veryfront_input_charge_usd",
      usage.veryfrontInputChargeUsd,
      timestamp,
    ),
    mlflowMetric(
      "veryfront_output_charge_usd",
      usage.veryfrontOutputChargeUsd,
      timestamp,
    ),
    mlflowMetric("veryfront_charge_usd", usage.veryfrontChargeUsd, timestamp),
    mlflowMetric("veryfront_billed_usd", usage.veryfrontBilledUsd, timestamp),
    mlflowMetric("cost_credits", usage.costCredits, timestamp),
  ]);
}

function toMetricKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "metric";
}

function frameworkMetricSummaryMetrics(
  report: EvalReport,
  timestamp: number,
): MlflowMetric[] {
  return report.summary.metrics.flatMap((metric) => {
    const key = `veryfront_metric.${toMetricKey(metric.name)}`;
    return compact([
      mlflowMetric(`${key}.pass_rate`, metric.passRate, timestamp),
      mlflowMetric(`${key}.passed`, metric.passed, timestamp),
      mlflowMetric(`${key}.failed`, metric.failed, timestamp),
      mlflowMetric(`${key}.skipped`, metric.skipped, timestamp),
    ]);
  });
}

function recordScoreMetrics(
  report: EvalReport,
  timestamp: number,
): MlflowMetric[] {
  const scores = new Map<string, number[]>();
  for (const record of report.records) {
    for (
      const result of [...(record.metrics ?? []), ...(record.checks ?? [])]
    ) {
      if (
        typeof result.score !== "number" || !Number.isFinite(result.score)
      ) continue;
      const key = `veryfront_metric.${toMetricKey(result.name)}.score_mean`;
      const values = scores.get(key) ?? [];
      values.push(result.score);
      scores.set(key, values);
    }
  }

  return compact(
    [...scores.entries()].map(([key, values]) => mlflowMetric(key, average(values), timestamp)),
  );
}

function classificationValue(
  value: unknown,
  ...keys: string[]
): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const entry = value[key];
    if (typeof entry === "string" && entry.trim().length > 0) return entry;
  }
  return undefined;
}

function classificationRowFromResult(
  result: NonNullable<EvalReport["records"][number]["metrics"]>[number],
): ClassificationRow | undefined {
  const expected = classificationValue(
    result.evidence,
    "expectedCategory",
    "expectedLabel",
    "expected",
  );
  const predicted = classificationValue(
    result.evidence,
    "predictedCategory",
    "predictedLabel",
    "predicted",
  );
  if (!expected || !predicted) return undefined;
  const confidence = isRecord(result.evidence) &&
      typeof result.evidence.confidence === "number" &&
      Number.isFinite(result.evidence.confidence)
    ? result.evidence.confidence
    : undefined;
  return {
    expected,
    predicted,
    correct: result.pass === true || expected === predicted,
    ...(confidence === undefined ? {} : { confidence }),
  };
}

function classificationRowsByMetric(
  report: EvalReport,
): Map<string, ClassificationRow[]> {
  const rowsByMetric = new Map<string, ClassificationRow[]>();
  for (const record of report.records) {
    for (
      const result of [...(record.metrics ?? []), ...(record.checks ?? [])]
    ) {
      const row = classificationRowFromResult(result);
      if (!row) continue;
      const rows = rowsByMetric.get(result.name) ?? [];
      rows.push(row);
      rowsByMetric.set(result.name, rows);
    }
  }
  return rowsByMetric;
}

function buildPerCategory(
  rows: ClassificationRow[],
): Record<string, { total: number; correct: number; accuracy: number }> {
  const result: Record<
    string,
    { total: number; correct: number; accuracy: number }
  > = {};
  for (const row of rows) {
    const category = result[row.expected] ??= {
      total: 0,
      correct: 0,
      accuracy: 0,
    };
    category.total += 1;
    if (row.correct) category.correct += 1;
  }
  for (const value of Object.values(result)) {
    value.accuracy = value.total === 0 ? 0 : value.correct / value.total;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildConfusion(
  rows: ClassificationRow[],
): Record<string, Record<string, number>> {
  const confusion: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const predictions = confusion[row.expected] ??= {};
    predictions[row.predicted] = (predictions[row.predicted] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(confusion).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildMacroMetrics(
  confusion: Record<string, Record<string, number>>,
): ClassificationMetricSet {
  const labels = new Set<string>(Object.keys(confusion));
  for (const predictions of Object.values(confusion)) {
    for (const label of Object.keys(predictions)) labels.add(label);
  }

  const metricSets = Array.from(labels).map(
    (label): ClassificationMetricSet => {
      const truePositive = confusion[label]?.[label] ?? 0;
      const actual = Object.values(confusion[label] ?? {}).reduce(
        (sum, count) => sum + count,
        0,
      );
      const predicted = Object.values(confusion).reduce(
        (sum, predictions) => sum + (predictions[label] ?? 0),
        0,
      );
      const precision = predicted === 0 ? 0 : truePositive / predicted;
      const recall = actual === 0 ? 0 : truePositive / actual;
      const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      return { precision, recall, f1 };
    },
  );

  if (metricSets.length === 0) return { precision: 0, recall: 0, f1: 0 };
  return {
    precision: average(metricSets.map((metric) => metric.precision)),
    recall: average(metricSets.map((metric) => metric.recall)),
    f1: average(metricSets.map((metric) => metric.f1)),
  };
}

function classificationMetricNames(
  metricName: string,
  singleClassificationMetric: boolean,
): string[] {
  const metricKey = toMetricKey(metricName);
  return singleClassificationMetric
    ? ["", `classification.${metricKey}.`]
    : [`classification.${metricKey}.`];
}

function classificationMetricsForRows(
  metricName: string,
  rows: ClassificationRow[],
  timestamp: number,
  singleClassificationMetric: boolean,
): MlflowMetric[] {
  const correct = rows.filter((row) => row.correct).length;
  const failureCount = rows.length - correct;
  const accuracy = rows.length === 0 ? 0 : correct / rows.length;
  const perCategory = buildPerCategory(rows);
  const confusion = buildConfusion(rows);
  const macro = buildMacroMetrics(confusion);
  const prefixes = classificationMetricNames(
    metricName,
    singleClassificationMetric,
  );
  const confidenceValues = rows
    .map((row) => row.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const metrics: MlflowMetric[] = [];

  for (const prefix of prefixes) {
    metrics.push(
      mlflowMetric(`${prefix}accuracy`, accuracy, timestamp)!,
      mlflowMetric(`${prefix}macro_precision`, macro.precision, timestamp)!,
      mlflowMetric(`${prefix}macro_recall`, macro.recall, timestamp)!,
      mlflowMetric(`${prefix}macro_f1`, macro.f1, timestamp)!,
      mlflowMetric(`${prefix}evaluated_count`, rows.length, timestamp)!,
      mlflowMetric(`${prefix}correct_count`, correct, timestamp)!,
      mlflowMetric(`${prefix}failure_count`, failureCount, timestamp)!,
    );

    if (confidenceValues.length > 0) {
      metrics.push(
        mlflowMetric(
          `${prefix}confidence_mean`,
          average(confidenceValues),
          timestamp,
        )!,
      );
    }

    for (const [category, value] of Object.entries(perCategory)) {
      const key = `${prefix}category.${toMetricKey(category)}`;
      metrics.push(
        mlflowMetric(`${key}.accuracy`, value.accuracy, timestamp)!,
        mlflowMetric(`${key}.correct`, value.correct, timestamp)!,
        mlflowMetric(`${key}.total`, value.total, timestamp)!,
      );
    }

    for (const [expected, predictions] of Object.entries(confusion)) {
      for (const [predicted, count] of Object.entries(predictions)) {
        metrics.push(
          mlflowMetric(
            `${prefix}confusion.${toMetricKey(expected)}.${toMetricKey(predicted)}`,
            count,
            timestamp,
          )!,
        );
      }
    }
  }

  return metrics;
}

function classificationMetrics(
  report: EvalReport,
  timestamp: number,
): MlflowMetric[] {
  const rowsByMetric = [...classificationRowsByMetric(report).entries()]
    .filter(([, rows]) => rows.length > 0);
  const singleClassificationMetric = rowsByMetric.length === 1;
  return rowsByMetric.flatMap(([metricName, rows]) =>
    classificationMetricsForRows(
      metricName,
      rows,
      timestamp,
      singleClassificationMetric,
    )
  );
}

function summaryMetrics(report: EvalReport, timestamp: number): MlflowMetric[] {
  return compact([
    mlflowMetric("veryfront_pass_rate", report.summary.passRate, timestamp),
    mlflowMetric("veryfront_records", report.summary.records, timestamp),
    mlflowMetric("veryfront_passed", report.summary.passed, timestamp),
    mlflowMetric("veryfront_failed", report.summary.failed, timestamp),
    mlflowMetric(
      "veryfront_skipped_results",
      report.summary.skippedResults,
      timestamp,
    ),
    mlflowMetric(
      "veryfront_gate_failures",
      report.summary.gateFailures?.length,
      timestamp,
    ),
    mlflowMetric(
      "veryfront_failed_examples",
      report.summary.failedExamples?.length,
      timestamp,
    ),
    mlflowMetric(
      "veryfront_flaky_examples",
      report.summary.flakes?.flaky,
      timestamp,
    ),
  ]);
}

function createMetrics(report: EvalReport, timestamp: number): MlflowMetric[] {
  return [
    ...summaryMetrics(report, timestamp),
    ...durationMetrics(report.summary.duration, timestamp),
    ...usageMetrics(report.summary.usage, timestamp),
    ...frameworkMetricSummaryMetrics(report, timestamp),
    ...recordScoreMetrics(report, timestamp),
    ...classificationMetrics(report, timestamp),
  ];
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createResultsJsonl(report: EvalReport): string {
  return report.records.length === 0
    ? ""
    : `${report.records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function safeArtifactPayload(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeArtifactPath(path: string): string {
  const normalized = path
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/");

  if (
    !normalized || normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    throw new Error(`Unsafe MLflow artifact path: ${path}`);
  }

  return normalized;
}

function normalizeMlflowArtifactsUri(uri: string): string {
  const trimmed = normalizeHttpUri(uri, "artifactsUri");
  if (trimmed.endsWith("/api/2.0/mlflow-artifacts/artifacts")) return trimmed;
  return `${trimmed}/api/2.0/mlflow-artifacts/artifacts`;
}

function extractArtifactRootPath(runArtifactUri: string | undefined): string {
  if (!runArtifactUri) {
    throw new Error("MLflow run artifact URI is required for artifact uploads");
  }

  if (runArtifactUri.startsWith("mlflow-artifacts:/")) {
    return normalizeArtifactPath(
      runArtifactUri.replace(/^mlflow-artifacts:\/*/, ""),
    );
  }

  if (runArtifactUri.startsWith("s3://")) {
    const objectStoreMatch = /^s3:\/\/[^/]+\/(.+)$/i.exec(runArtifactUri);
    if (objectStoreMatch) return normalizeArtifactPath(objectStoreMatch[1]!);
  }

  throw new Error(
    `Unsupported MLflow artifact URI: ${runArtifactUri}. Supported proxied artifact roots: ${
      SUPPORTED_MLFLOW_PROXY_ARTIFACT_URI_SCHEMES.join(", ")
    }`,
  );
}

function buildMlflowArtifactUploadUrl(input: {
  runArtifactUri?: string;
  artifactPath: string;
  artifactsUri?: string;
}): string {
  if (
    input.runArtifactUri?.startsWith("http://") ||
    input.runArtifactUri?.startsWith("https://")
  ) {
    return `${normalizeHttpUri(input.runArtifactUri, "run artifact URI")}/${input.artifactPath}`;
  }

  const artifactRootPath = extractArtifactRootPath(input.runArtifactUri);
  if (!input.artifactsUri) {
    throw new Error(
      `MLflow artifactsUri is required for non-HTTP artifact URI ${input.runArtifactUri}. Configure MLFLOW_ARTIFACTS_URI or config.artifactsUri.`,
    );
  }

  const artifactServerUri = normalizeMlflowArtifactsUri(input.artifactsUri);

  return `${artifactServerUri}/${artifactRootPath}/${input.artifactPath}`;
}

async function uploadMlflowArtifact(input: {
  fetchImpl: EvalReportMlflowFetch;
  runArtifactUri?: string;
  artifactsUri?: string;
  artifactPath: string;
  content: string;
  contentType: string;
}): Promise<MlflowArtifactUploadResult> {
  const artifactPath = normalizeArtifactPath(input.artifactPath);
  const uploadUrl = buildMlflowArtifactUploadUrl({
    runArtifactUri: input.runArtifactUri,
    artifactsUri: input.artifactsUri,
    artifactPath,
  });
  const response = await input.fetchImpl(uploadUrl, {
    method: "PUT",
    headers: { "content-type": input.contentType },
    body: input.content,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `MLflow artifact upload failed (${response.status}): ${text || response.statusText}`,
    );
  }

  return { artifactPath, uploadUrl };
}

async function uploadMlflowJsonArtifact(input: {
  fetchImpl: EvalReportMlflowFetch;
  runArtifactUri?: string;
  artifactsUri?: string;
  artifactPath: string;
  value: unknown;
}): Promise<MlflowArtifactUploadResult> {
  return uploadMlflowArtifact({
    ...input,
    content: safeArtifactPayload(input.value),
    contentType: "application/json",
  });
}

class MlflowNotFoundError extends Error {}
class MlflowAlreadyExistsError extends Error {}

async function readMlflowResponse(response: Response): Promise<any> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (response.ok) return payload;

  const code = typeof payload.error_code === "string" ? payload.error_code : undefined;
  const message = typeof payload.message === "string" ? payload.message : response.statusText;
  if (response.status === 404 || code === "RESOURCE_DOES_NOT_EXIST") {
    throw new MlflowNotFoundError(message);
  }
  if (code === "RESOURCE_ALREADY_EXISTS") {
    throw new MlflowAlreadyExistsError(message);
  }
  throw new Error(
    `MLflow request failed (${response.status} ${code ?? "unknown"}): ${message}`,
  );
}

async function mlflowGet(
  fetchImpl: EvalReportMlflowFetch,
  trackingUri: string,
  authHeaders: Record<string, string>,
  endpoint: string,
  query: Record<string, string>,
): Promise<any> {
  const url = new URL(`${trackingUri}/api/2.0/mlflow/${endpoint}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return readMlflowResponse(await fetchImpl(url, { headers: authHeaders }));
}

async function mlflowPost(
  fetchImpl: EvalReportMlflowFetch,
  trackingUri: string,
  authHeaders: Record<string, string>,
  endpoint: string,
  body: unknown,
): Promise<any> {
  return readMlflowResponse(
    await fetchImpl(`${trackingUri}/api/2.0/mlflow/${endpoint}`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

interface MlflowLogBatchChunk {
  params: MlflowParam[];
  metrics: MlflowMetric[];
  tags: MlflowTag[];
}

function logBatchEntryCount(chunk: MlflowLogBatchChunk): number {
  return chunk.params.length + chunk.metrics.length + chunk.tags.length;
}

function logBatchBodySize(runId: string, chunk: MlflowLogBatchChunk): number {
  const body = JSON.stringify({
    run_id: runId,
    params: chunk.params,
    metrics: chunk.metrics,
    tags: chunk.tags,
  });
  return LOG_BATCH_BODY_ENCODER.encode(body).length;
}

function canAddLogBatchEntry(
  runId: string,
  chunk: MlflowLogBatchChunk,
  kind: keyof MlflowLogBatchChunk,
  entry: MlflowLogBatchChunk[keyof MlflowLogBatchChunk][number],
): boolean {
  if (logBatchEntryCount(chunk) >= MLFLOW_LOG_BATCH_MAX_TOTAL_ENTRIES) {
    return false;
  }
  if (
    kind === "metrics" && chunk.metrics.length >= MLFLOW_LOG_BATCH_MAX_METRICS
  ) return false;
  if (kind === "params" && chunk.params.length >= MLFLOW_LOG_BATCH_MAX_PARAMS) {
    return false;
  }
  if (kind === "tags" && chunk.tags.length >= MLFLOW_LOG_BATCH_MAX_TAGS) {
    return false;
  }

  const nextChunk = {
    params: kind === "params" ? [...chunk.params, entry as MlflowParam] : chunk.params,
    metrics: kind === "metrics" ? [...chunk.metrics, entry as MlflowMetric] : chunk.metrics,
    tags: kind === "tags" ? [...chunk.tags, entry as MlflowTag] : chunk.tags,
  };
  return logBatchBodySize(runId, nextChunk) <= MLFLOW_LOG_BATCH_MAX_BYTES;
}

function createLogBatchChunks(input: {
  runId: string;
  params?: MlflowParam[];
  metrics?: MlflowMetric[];
  tags?: MlflowTag[];
}): MlflowLogBatchChunk[] {
  const chunks: MlflowLogBatchChunk[] = [];
  let current: MlflowLogBatchChunk = { params: [], metrics: [], tags: [] };

  const flush = () => {
    if (logBatchEntryCount(current) === 0) return;
    chunks.push(current);
    current = { params: [], metrics: [], tags: [] };
  };

  const add = <K extends keyof MlflowLogBatchChunk>(
    kind: K,
    entry: MlflowLogBatchChunk[K][number],
  ) => {
    if (!canAddLogBatchEntry(input.runId, current, kind, entry)) flush();
    if (!canAddLogBatchEntry(input.runId, current, kind, entry)) {
      throw new Error(
        `MLflow log-batch ${kind} entry is too large to upload safely`,
      );
    }
    current[kind].push(entry as never);
  };

  for (const param of input.params ?? []) add("params", param);
  for (const tag of input.tags ?? []) add("tags", tag);
  for (const metric of input.metrics ?? []) add("metrics", metric);
  flush();

  return chunks;
}

async function logMlflowBatch(
  fetchImpl: EvalReportMlflowFetch,
  trackingUri: string,
  input: {
    runId: string;
    authHeaders: Record<string, string>;
    params?: MlflowParam[];
    metrics?: MlflowMetric[];
    tags?: MlflowTag[];
  },
): Promise<void> {
  for (const chunk of createLogBatchChunks(input)) {
    await mlflowPost(
      fetchImpl,
      trackingUri,
      input.authHeaders,
      "runs/log-batch",
      {
        run_id: input.runId,
        params: chunk.params,
        metrics: chunk.metrics,
        tags: chunk.tags,
      },
    );
  }
}

async function getOrCreateMlflowExperiment(input: {
  fetchImpl: EvalReportMlflowFetch;
  trackingUri: string;
  authHeaders: Record<string, string>;
  experimentName: string;
  report: EvalReport;
  context: EvalReportExportContext;
}): Promise<string> {
  const existing = await mlflowGet(
    input.fetchImpl,
    input.trackingUri,
    input.authHeaders,
    "experiments/get-by-name",
    {
      experiment_name: input.experimentName,
    },
  ).catch((error) => {
    if (error instanceof MlflowNotFoundError) return undefined;
    throw error;
  });

  if (existing?.experiment?.experiment_id) {
    return String(existing.experiment.experiment_id);
  }

  const created = await mlflowPost(
    input.fetchImpl,
    input.trackingUri,
    input.authHeaders,
    "experiments/create",
    {
      name: input.experimentName,
      tags: compact([
        tag("eval.framework", "veryfront"),
        tag("eval.definition_id", input.report.definitionId),
        tag("eval.project_reference", input.context.projectReference),
      ]),
    },
  ).catch(async (error) => {
    if (!(error instanceof MlflowAlreadyExistsError)) throw error;
    const raceWinner = await mlflowGet(
      input.fetchImpl,
      input.trackingUri,
      input.authHeaders,
      "experiments/get-by-name",
      {
        experiment_name: input.experimentName,
      },
    );
    return { experiment_id: raceWinner.experiment.experiment_id };
  });

  return String(created.experiment_id);
}

async function uploadReportArtifacts(input: {
  fetchImpl: EvalReportMlflowFetch;
  artifactsUri?: string;
  runArtifactUri?: string;
  report: EvalReport;
}): Promise<string[]> {
  const uploads = await Promise.all([
    uploadMlflowJsonArtifact({
      fetchImpl: input.fetchImpl,
      runArtifactUri: input.runArtifactUri,
      artifactsUri: input.artifactsUri,
      artifactPath: "veryfront-eval/report.json",
      value: input.report,
    }),
    uploadMlflowJsonArtifact({
      fetchImpl: input.fetchImpl,
      runArtifactUri: input.runArtifactUri,
      artifactsUri: input.artifactsUri,
      artifactPath: "veryfront-eval/summary.json",
      value: input.report.summary,
    }),
    uploadMlflowArtifact({
      fetchImpl: input.fetchImpl,
      runArtifactUri: input.runArtifactUri,
      artifactsUri: input.artifactsUri,
      artifactPath: "veryfront-eval/results.jsonl",
      content: createResultsJsonl(input.report),
      contentType: "application/x-ndjson",
    }),
  ]);
  return uploads.map((upload) => upload.artifactPath);
}

export class EvalReportMlflowExporter implements EvalReportExporter {
  readonly id: string;
  private readonly config: EvalReportMlflowExtensionConfig & {
    trackingUri: string;
  };
  private readonly fetchImpl: EvalReportMlflowFetch;

  constructor(
    config: EvalReportMlflowExtensionConfig & {
      id: string;
      trackingUri: string;
    },
    fetchImpl: EvalReportMlflowFetch = fetch,
  ) {
    this.id = config.id;
    this.config = {
      ...config,
      trackingUri: normalizeHttpUri(config.trackingUri, "trackingUri"),
      ...(config.artifactsUri
        ? { artifactsUri: normalizeHttpUri(config.artifactsUri, "artifactsUri") }
        : {}),
    };
    this.fetchImpl = fetchImpl;
  }

  async export(
    report: EvalReport,
    context: EvalReportExportContext,
  ): Promise<EvalReportExportReceipt> {
    const trackingUri = this.config.trackingUri;
    const authHeaders = createTrackingAuthHeaders(this.config);
    const selectedExperimentName = experimentName(this.config, report, context);
    const experimentId = await getOrCreateMlflowExperiment({
      fetchImpl: this.fetchImpl,
      trackingUri,
      authHeaders,
      experimentName: selectedExperimentName,
      report,
      context,
    });
    const startedAt = Date.parse(report.startedAt);
    const createdRun = await mlflowPost(
      this.fetchImpl,
      trackingUri,
      authHeaders,
      "runs/create",
      {
        experiment_id: experimentId,
        run_name: normalizeMlflowTagValue(runName(this.config, report)),
        start_time: Number.isFinite(startedAt) ? startedAt : Date.now(),
        tags: createRunTags(this.config, report, context),
      },
    );

    const runId = String(
      createdRun.run.info.run_id ?? createdRun.run.info.run_uuid,
    );
    const runArtifactUri = String(createdRun.run.info.artifact_uri ?? "");
    try {
      const now = Date.now();
      await logMlflowBatch(this.fetchImpl, trackingUri, {
        runId,
        authHeaders,
        params: createRunParams(report, context),
        metrics: createMetrics(report, now),
        tags: compact([
          tag("veryfront.summary.failed", report.summary.failed),
          tag("veryfront.summary.passed", report.summary.passed),
        ]),
      });

      const artifacts = await uploadReportArtifacts({
        fetchImpl: this.fetchImpl,
        artifactsUri: this.config.artifactsUri,
        runArtifactUri,
        report,
      });

      await logMlflowBatch(this.fetchImpl, trackingUri, {
        runId,
        authHeaders,
        tags: [
          { key: "artifacts.logged", value: "true" },
          { key: "artifacts.count", value: String(artifacts.length) },
        ],
      });

      await mlflowPost(this.fetchImpl, trackingUri, authHeaders, "runs/update", {
        run_id: runId,
        status: report.summary.failed === 0 ? "FINISHED" : "FAILED",
        end_time: Date.now(),
      });

      return {
        externalRunId: runId,
        url: `${trackingUri}/#/experiments/${experimentId}/runs/${runId}`,
        metadata: {
          experimentId,
          experimentName: selectedExperimentName,
          artifacts,
        },
      };
    } catch (error) {
      await mlflowPost(this.fetchImpl, trackingUri, authHeaders, "runs/update", {
        run_id: runId,
        status: "FAILED",
        end_time: Date.now(),
      }).catch(() => undefined);
      throw error;
    }
  }
}

export function createEvalReportMlflowExporter(
  config: EvalReportMlflowExtensionConfig & {
    id?: string;
    trackingUri: string;
  },
  fetchImpl?: EvalReportMlflowFetch,
): EvalReportMlflowExporter {
  return new EvalReportMlflowExporter(
    { ...config, id: DEFAULT_EXPORTER_ID },
    fetchImpl,
  );
}

const extEvalReportMlflow: ExtensionFactory = (config?: unknown) => {
  const factoryConfig = resolveExporterConfig(normalizeConfig(config));
  let registry: EvalReportExporterRegistry | undefined;
  let registeredId: string | undefined;

  return {
    name: "ext-eval-report-mlflow",
    version: "0.1.0",
    contracts: EXTENSION_METADATA.contracts,
    capabilities: EXTENSION_METADATA.capabilities,
    setup(ctx) {
      registry = ctx.require<EvalReportExporterRegistry>(
        EvalReportExporterRegistryName,
      );
      const activationTrackingUri = readEnv(ENV_TRACKING_URI);
      if (!activationTrackingUri) {
        ctx.logger.debug(
          `[ext-eval-report-mlflow] Skipping EvalReportExporter "${factoryConfig.id}": no MLFLOW_TRACKING_URI configured`,
        );
        return;
      }

      registry.register(
        new EvalReportMlflowExporter(
          {
            ...factoryConfig,
            trackingUri: factoryConfig.trackingUri ?? activationTrackingUri,
          },
          factoryConfig.fetch,
        ),
      );
      registeredId = factoryConfig.id;
      ctx.logger.info(
        `[ext-eval-report-mlflow] EvalReportExporter "${factoryConfig.id}" registered`,
      );
    },
    teardown() {
      if (registry && registeredId) registry.unregister(registeredId);
      registry = undefined;
      registeredId = undefined;
    },
  };
};

export default extEvalReportMlflow;
