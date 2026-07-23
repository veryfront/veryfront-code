import type {
  EvalDataset,
  EvalDefinition,
  EvalDurationSummary,
  EvalExample,
  EvalFailedExampleSummary,
  EvalFlakeSummary,
  EvalGateFailureSummary,
  EvalMetricResult,
  EvalMetricSummary,
  EvalRecord,
  EvalReport,
  EvalReportDatasetMetadata,
  EvalReportMetadata,
  EvalReportSummary,
  EvalUsageSummary,
} from "./types.ts";
import { canonicalJsonStringify } from "./canonical-json.ts";
import { createEvalValidationError } from "./validation.ts";
import { assertValidEvalDate, assertValidEvalRunId } from "./run-id.ts";

/** Additive eval report contract version written by new reports and summary artifacts. */
export const EVAL_REPORT_SCHEMA_VERSION = 2;

const USAGE_NUMERIC_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "billableInputTokens",
  "billableOutputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningTokens",
  "costUsd",
  "providerInputCostUsd",
  "providerOutputCostUsd",
  "providerCostUsd",
  "veryfrontInputChargeUsd",
  "veryfrontOutputChargeUsd",
  "veryfrontChargeUsd",
  "veryfrontBilledUsd",
  "costCredits",
] as const satisfies ReadonlyArray<keyof EvalUsageSummary>;
const USAGE_INTEGER_KEYS = new Set<keyof EvalUsageSummary>([
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "billableInputTokens",
  "billableOutputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "reasoningTokens",
]);
const MAX_EVAL_REPORT_RECORDS = 100_000;
const MAX_EVAL_REPORT_TRACE_ITEMS = 100_000;
const MAX_EVAL_REPORT_CONTEXT_ITEMS = 10_000;
const MAX_EVAL_REPORT_RESULTS = 10_000;
const MAX_EVAL_REPORT_TEXT_LENGTH = 16_384;
const EVAL_METRIC_FAMILIES = new Set(["answer", "agent", "ops", "judge", "knowledge", "check"]);
const EVAL_SEVERITIES = new Set(["gate", "soft", "budget"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateEvalRecords(records: EvalRecord[]): void {
  if (!Array.isArray(records) || records.length > MAX_EVAL_REPORT_RECORDS) {
    throw createEvalValidationError(
      `Eval reports must contain at most ${MAX_EVAL_REPORT_RECORDS} records`,
    );
  }
  for (const [index, record] of records.entries()) {
    if (!isRecord(record) || !isRecord(record.usage) || !isRecord(record.metadata)) {
      throw createEvalValidationError(
        `Eval record ${index}, metadata, and usage must be objects`,
      );
    }
    for (const key of ["id", "exampleId"] as const) {
      const value = record[key];
      if (
        typeof value !== "string" || value.length === 0 ||
        value.length > MAX_EVAL_REPORT_TEXT_LENGTH
      ) {
        throw createEvalValidationError(`Eval record ${index} ${key} must be a valid string`);
      }
    }
    if (
      typeof record.evalId !== "string" || record.evalId.length > MAX_EVAL_REPORT_TEXT_LENGTH
    ) {
      throw createEvalValidationError(`Eval record ${index} evalId must be a valid string`);
    }
    if (!Number.isSafeInteger(record.repetition) || record.repetition < 1) {
      throw createEvalValidationError(
        `Eval record ${index} repetition must be a positive integer`,
      );
    }
    if (typeof record.completed !== "boolean") {
      throw createEvalValidationError(`Eval record ${index} completed must be a boolean`);
    }
    if (record.error !== undefined && typeof record.error !== "string") {
      throw createEvalValidationError(`Eval record ${index} error must be a string`);
    }
    if (
      !isRecord(record.trace) || !Array.isArray(record.trace.events) ||
      !Array.isArray(record.trace.toolCalls) ||
      record.trace.events.length > MAX_EVAL_REPORT_TRACE_ITEMS ||
      record.trace.toolCalls.length > MAX_EVAL_REPORT_TRACE_ITEMS
    ) {
      throw createEvalValidationError(`Eval record ${index} trace is invalid or too large`);
    }
    if (
      (record.retrievedContext !== undefined &&
        (!Array.isArray(record.retrievedContext) ||
          record.retrievedContext.length > MAX_EVAL_REPORT_CONTEXT_ITEMS)) ||
      (record.citations !== undefined &&
        (!Array.isArray(record.citations) ||
          record.citations.length > MAX_EVAL_REPORT_CONTEXT_ITEMS))
    ) {
      throw createEvalValidationError(
        `Eval record ${index} context evidence is invalid or too large`,
      );
    }
    if (
      (record.metrics !== undefined && !Array.isArray(record.metrics)) ||
      (record.checks !== undefined && !Array.isArray(record.checks)) ||
      (record.metrics?.length ?? 0) > MAX_EVAL_REPORT_RESULTS ||
      (record.checks?.length ?? 0) > MAX_EVAL_REPORT_RESULTS
    ) {
      throw createEvalValidationError(`Eval record ${index} metrics and checks must be arrays`);
    }
    if (!Number.isFinite(record.durationMs) || record.durationMs < 0) {
      throw createEvalValidationError(
        `Eval record ${index} durationMs must be a finite non-negative number`,
      );
    }
    for (const key of USAGE_NUMERIC_KEYS) {
      const value = record.usage[key];
      if (value === undefined) continue;
      if (
        typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
        (USAGE_INTEGER_KEYS.has(key) && !Number.isSafeInteger(value))
      ) {
        throw createEvalValidationError(
          `Eval record ${index} usage.${key} must be a valid non-negative number`,
        );
      }
    }
    if (
      record.usage.costSource !== undefined &&
      (typeof record.usage.costSource !== "string" ||
        !["gateway", "missing", "partial"].includes(record.usage.costSource))
    ) {
      throw createEvalValidationError(`Eval record ${index} usage.costSource is invalid`);
    }
    if (
      record.usage.usageCaptureStatus !== undefined &&
      (typeof record.usage.usageCaptureStatus !== "string" ||
        !["complete", "missing", "partial"].includes(record.usage.usageCaptureStatus))
    ) {
      throw createEvalValidationError(`Eval record ${index} usage.usageCaptureStatus is invalid`);
    }
    if (
      record.usage.billingMode !== undefined &&
      (typeof record.usage.billingMode !== "string" ||
        !["direct", "deferred"].includes(record.usage.billingMode))
    ) {
      throw createEvalValidationError(`Eval record ${index} usage.billingMode is invalid`);
    }
    for (const result of [...(record.metrics ?? []), ...(record.checks ?? [])]) {
      if (
        !isRecord(result) || typeof result.name !== "string" || result.name.length === 0 ||
        !EVAL_METRIC_FAMILIES.has(result.family) || !EVAL_SEVERITIES.has(result.severity) ||
        (result.pass !== undefined && typeof result.pass !== "boolean") ||
        (result.skipped !== undefined && typeof result.skipped !== "boolean")
      ) {
        throw createEvalValidationError(`Eval record ${index} contains an invalid metric result`);
      }
      if (result.score !== undefined && !Number.isFinite(result.score)) {
        throw createEvalValidationError(
          `Eval record ${index} metric score must be finite when provided`,
        );
      }
    }
  }
}

function stableStringify(value: unknown): string {
  const result = canonicalJsonStringify(value);
  if (result === undefined) throw new TypeError("Value is not JSON-serializable");
  return result;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createDatasetHashInput(dataset: EvalDataset, examples: EvalExample[]) {
  return {
    kind: dataset.kind,
    examples: examples.map((example) => ({
      id: example.id,
      input: example.input,
      ...(Object.hasOwn(example, "reference") ? { reference: example.reference } : {}),
      ...(example.metadata ? { metadata: example.metadata } : {}),
    })),
  };
}

/** Create stable dataset metadata for report consumers and CI artifacts. */
export async function createEvalDatasetMetadata(
  dataset: EvalDataset,
  examples: EvalExample[],
): Promise<EvalReportDatasetMetadata> {
  const hashInput = createDatasetHashInput(dataset, examples);
  return {
    kind: dataset.kind,
    ...(dataset.path ? { path: dataset.path } : {}),
    examples: examples.length,
    hash: `sha256:${await sha256Hex(stableStringify(hashInput))}`,
  };
}

function isBlockingFailure(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function recordPassed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return false;
  const results = [...(record.metrics ?? []), ...(record.checks ?? [])];
  return results.every((result) => !isBlockingFailure(result));
}

function allResults(record: EvalRecord): EvalMetricResult[] {
  return [...(record.metrics ?? []), ...(record.checks ?? [])];
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index] ?? 0;
}

function summarizeDurations(records: EvalRecord[]): EvalDurationSummary {
  const durations = records.map((record) => record.durationMs).sort((a, b) => a - b);
  const totalMs = durations.reduce((sum, value) => {
    const total = sum + value;
    if (!Number.isFinite(total)) {
      throw createEvalValidationError("Eval duration total exceeds the numeric limit");
    }
    return total;
  }, 0);
  return {
    totalMs,
    minMs: durations[0] ?? 0,
    maxMs: durations.at(-1) ?? 0,
    meanMs: durations.length === 0 ? 0 : totalMs / durations.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
  };
}

function addUsageValue(
  summary: EvalUsageSummary,
  key: typeof USAGE_NUMERIC_KEYS[number],
  value: number | undefined,
): void {
  if (value === undefined) return;
  const total = (summary[key] ?? 0) + value;
  if (!Number.isFinite(total) || (USAGE_INTEGER_KEYS.has(key) && !Number.isSafeInteger(total))) {
    throw createEvalValidationError(`Eval usage total for ${key} exceeds the numeric limit`);
  }
  summary[key] = total;
}

function summarizeUsageState<T extends "gateway" | "complete" | "missing" | "partial">(
  values: T[],
): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((value) => value === first) ? first : "partial" as T;
}

function summarizeBillingMode(
  values: Array<NonNullable<EvalUsageSummary["billingMode"]>>,
): EvalUsageSummary["billingMode"] | undefined {
  if (values.includes("deferred")) return "deferred";
  if (values.includes("direct")) return "direct";
  return undefined;
}

function summarizeUsage(records: EvalRecord[]): EvalUsageSummary {
  const summary: EvalUsageSummary = {};
  const costSources: Array<NonNullable<EvalUsageSummary["costSource"]>> = [];
  const captureStatuses: Array<NonNullable<EvalUsageSummary["usageCaptureStatus"]>> = [];
  const billingModes: Array<NonNullable<EvalUsageSummary["billingMode"]>> = [];
  let hasExplicitCostSource = false;
  let hasExplicitCaptureStatus = false;

  for (const record of records) {
    for (const key of USAGE_NUMERIC_KEYS) {
      addUsageValue(summary, key, record.usage[key]);
    }

    if (record.usage.costSource !== undefined) hasExplicitCostSource = true;
    if (record.usage.usageCaptureStatus !== undefined) hasExplicitCaptureStatus = true;
    costSources.push(record.usage.costSource ?? "missing");
    captureStatuses.push(record.usage.usageCaptureStatus ?? "missing");
    if (record.usage.billingMode !== undefined) {
      billingModes.push(record.usage.billingMode);
    }
  }

  const costSource = hasExplicitCostSource ? summarizeUsageState(costSources) : undefined;
  const usageCaptureStatus = hasExplicitCaptureStatus
    ? summarizeUsageState(captureStatuses)
    : undefined;
  const billingMode = summarizeBillingMode(billingModes);
  if (costSource) summary.costSource = costSource;
  if (billingMode) summary.billingMode = billingMode;
  if (usageCaptureStatus) summary.usageCaptureStatus = usageCaptureStatus;
  return summary;
}

function createRecordFailure(record: EvalRecord): EvalGateFailureSummary | null {
  if (record.completed && !record.error) return null;
  return {
    recordId: record.id,
    exampleId: record.exampleId,
    repetition: record.repetition,
    name: "record.error",
    family: "check",
    severity: "gate",
    explanation: record.error ?? "Record did not complete.",
  };
}

function createResultFailure(
  record: EvalRecord,
  result: EvalMetricResult,
): EvalGateFailureSummary {
  return {
    recordId: record.id,
    exampleId: record.exampleId,
    repetition: record.repetition,
    name: result.name,
    family: result.family,
    severity: result.severity === "budget" ? "budget" : "gate",
    ...(result.explanation ? { explanation: result.explanation } : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
  };
}

function summarizeGateFailures(records: EvalRecord[]): EvalGateFailureSummary[] {
  const failures: EvalGateFailureSummary[] = [];
  for (const record of records) {
    const recordFailure = createRecordFailure(record);
    if (recordFailure) failures.push(recordFailure);

    for (const result of allResults(record)) {
      if (isBlockingFailure(result)) failures.push(createResultFailure(record, result));
    }
  }
  return failures;
}

function summarizeFailedExamples(records: EvalRecord[]): {
  failedExamples: EvalFailedExampleSummary[];
  flakes: EvalFlakeSummary;
} {
  const examples = new Map<string, { passed: number; failed: number }>();
  for (const record of records) {
    const summary = examples.get(record.exampleId) ?? { passed: 0, failed: 0 };
    if (recordPassed(record)) {
      summary.passed += 1;
    } else {
      summary.failed += 1;
    }
    examples.set(record.exampleId, summary);
  }

  const failedExamples: EvalFailedExampleSummary[] = [];
  const flakes: EvalFlakeSummary = {
    examples: examples.size,
    stablePassed: 0,
    stableFailed: 0,
    flaky: 0,
  };

  for (const [exampleId, summary] of examples.entries()) {
    const recordsForExample = summary.passed + summary.failed;
    const flaky = summary.passed > 0 && summary.failed > 0;
    if (flaky) {
      flakes.flaky += 1;
    } else if (summary.failed > 0) {
      flakes.stableFailed += 1;
    } else {
      flakes.stablePassed += 1;
    }

    if (summary.failed === 0) continue;
    failedExamples.push({
      exampleId,
      records: recordsForExample,
      passed: summary.passed,
      failed: summary.failed,
      passRate: recordsForExample === 0 ? 1 : summary.passed / recordsForExample,
      flaky,
    });
  }

  return { failedExamples, flakes };
}

function summarizeMetricResults(records: EvalRecord[]): EvalMetricSummary[] {
  const summaries = new Map<string, EvalMetricSummary>();

  for (const record of records) {
    for (const result of allResults(record)) {
      const key = `${result.name}:${result.family}:${result.severity}`;
      const summary = summaries.get(key) ?? {
        name: result.name,
        family: result.family,
        severity: result.severity,
        passed: 0,
        failed: 0,
        skipped: 0,
        passRate: 0,
      };

      if (result.skipped) {
        summary.skipped += 1;
      } else if (result.pass === false) {
        summary.failed += 1;
      } else {
        summary.passed += 1;
      }

      const denominator = summary.passed + summary.failed;
      summary.passRate = denominator === 0 ? 1 : summary.passed / denominator;
      summaries.set(key, summary);
    }
  }

  return [...summaries.values()];
}

/** Summarize eval records into pass/fail and metric aggregates. */
export function summarizeEvalRecords(records: EvalRecord[]): EvalReportSummary {
  validateEvalRecords(records);
  const passed = records.filter(recordPassed).length;
  const failed = records.length - passed;
  const { failedExamples, flakes } = summarizeFailedExamples(records);
  return {
    records: records.length,
    passed,
    failed,
    passRate: records.length === 0 ? 1 : passed / records.length,
    metrics: summarizeMetricResults(records),
    skippedResults: records.reduce(
      (count, record) => count + allResults(record).filter((result) => result.skipped).length,
      0,
    ),
    duration: summarizeDurations(records),
    usage: summarizeUsage(records),
    gateFailures: summarizeGateFailures(records),
    failedExamples,
    flakes,
  };
}

/** Create a JSON-serializable eval report from executed records. */
export function createEvalReport(input: {
  definition: EvalDefinition;
  records: EvalRecord[];
  runId: string;
  startedAt: Date;
  endedAt: Date;
  dataset?: EvalReportDatasetMetadata;
  metadata?: EvalReportMetadata;
}): EvalReport {
  assertValidEvalRunId(input.runId);
  assertValidEvalDate(input.startedAt);
  assertValidEvalDate(input.endedAt);
  if (input.endedAt.getTime() < input.startedAt.getTime()) {
    throw createEvalValidationError("Eval report endedAt must not precede startedAt");
  }
  return {
    kind: "eval-report",
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    runId: input.runId,
    definitionId: input.definition.id,
    targetKind: input.definition.targetKind,
    target: input.definition.target,
    ...(input.dataset ? { dataset: input.dataset } : {}),
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    summary: summarizeEvalRecords(input.records),
    records: input.records,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
