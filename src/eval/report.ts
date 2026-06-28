import type {
  EvalDefinition,
  EvalDurationSummary,
  EvalFailedExampleSummary,
  EvalFlakeSummary,
  EvalGateFailureSummary,
  EvalMetricResult,
  EvalMetricSummary,
  EvalRecord,
  EvalReport,
  EvalReportMetadata,
  EvalReportSummary,
  EvalUsageSummary,
} from "./types.ts";

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
  const totalMs = durations.reduce((sum, value) => sum + value, 0);
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
  summary[key] = (summary[key] ?? 0) + value;
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
  metadata?: EvalReportMetadata;
}): EvalReport {
  return {
    kind: "eval-report",
    runId: input.runId,
    definitionId: input.definition.id,
    targetKind: input.definition.targetKind,
    target: input.definition.target,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    summary: summarizeEvalRecords(input.records),
    records: input.records,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
