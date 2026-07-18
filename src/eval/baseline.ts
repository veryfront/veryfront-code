import type {
  EvalBudgetDeltaSummary,
  EvalMetricDeltaSummary,
  EvalMetricSummary,
  EvalReport,
  EvalReportComparison,
  EvalReportComparisonPolicy,
} from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

function metricKey(metric: EvalMetricSummary): string {
  return `${metric.name}:${metric.family}:${metric.severity}`;
}

function createMetricIndex(report: EvalReport): Map<string, EvalMetricSummary> {
  const metrics = new Map<string, EvalMetricSummary>();
  for (const metric of report.summary.metrics) {
    metrics.set(metricKey(metric), metric);
  }
  return metrics;
}

function createMetricOrder(current: EvalReport, baseline: EvalReport): string[] {
  const keys = new Set<string>();
  for (const metric of current.summary.metrics) keys.add(metricKey(metric));
  for (const metric of baseline.summary.metrics) keys.add(metricKey(metric));
  return [...keys];
}

function firstMetricForKey(
  key: string,
  current: Map<string, EvalMetricSummary>,
  baseline: Map<string, EvalMetricSummary>,
): EvalMetricSummary {
  const metric = current.get(key) ?? baseline.get(key);
  if (!metric) {
    throw INVALID_ARGUMENT.create({
      detail: `Metric key "${key}" was not present in either report.`,
    });
  }
  return metric;
}

function nullableDelta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : current - baseline;
}

function metricRegressed(
  current: EvalMetricSummary | undefined,
  baseline: EvalMetricSummary | undefined,
  policy: Required<
    Pick<EvalReportComparisonPolicy, "metricPassRateDropThreshold" | "failedDeltaThreshold">
  >,
): boolean {
  if (!baseline) return false;
  if (!current) return true;
  return baseline.passRate - current.passRate > policy.metricPassRateDropThreshold ||
    current.failed - baseline.failed > policy.failedDeltaThreshold;
}

function createMetricDelta(
  key: string,
  current: Map<string, EvalMetricSummary>,
  baseline: Map<string, EvalMetricSummary>,
  policy: Required<
    Pick<EvalReportComparisonPolicy, "metricPassRateDropThreshold" | "failedDeltaThreshold">
  >,
): EvalMetricDeltaSummary {
  const metric = firstMetricForKey(key, current, baseline);
  const currentMetric = current.get(key);
  const baselineMetric = baseline.get(key);
  const currentPassRate = currentMetric?.passRate ?? null;
  const baselinePassRate = baselineMetric?.passRate ?? null;
  const currentFailed = currentMetric?.failed ?? null;
  const baselineFailed = baselineMetric?.failed ?? null;

  return {
    name: metric.name,
    family: metric.family,
    severity: metric.severity,
    baselinePassRate,
    currentPassRate,
    passRateDelta: nullableDelta(currentPassRate, baselinePassRate),
    baselineFailed,
    currentFailed,
    failedDelta: nullableDelta(currentFailed, baselineFailed),
    regressed: metricRegressed(currentMetric, baselineMetric, policy),
  };
}

function positiveOrZero(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function createPercentDelta(current: number, baseline: number): number | null {
  if (baseline === 0) return null;
  return (current - baseline) / Math.abs(baseline);
}

function budgetRegressed(
  current: number,
  baseline: number,
  threshold: number | undefined,
): boolean {
  if (threshold === undefined) return false;
  if (baseline === 0) return current > baseline;
  return (current - baseline) / Math.abs(baseline) > threshold;
}

function createBudgetDelta(
  name: string,
  family: EvalBudgetDeltaSummary["family"],
  current: number | undefined,
  baseline: number | undefined,
  threshold: number | undefined,
): EvalBudgetDeltaSummary | undefined {
  const currentValue = positiveOrZero(current);
  const baselineValue = positiveOrZero(baseline);
  if (currentValue === undefined || baselineValue === undefined) return undefined;

  return {
    name,
    family,
    baselineValue,
    currentValue,
    delta: currentValue - baselineValue,
    percentDelta: createPercentDelta(currentValue, baselineValue),
    threshold: threshold ?? null,
    regressed: budgetRegressed(currentValue, baselineValue, threshold),
  };
}

function createBudgetDeltas(
  current: EvalReport,
  baseline: EvalReport,
  policy: Pick<EvalReportComparisonPolicy, "usageIncreaseThreshold" | "latencyIncreaseThreshold">,
): EvalBudgetDeltaSummary[] {
  return [
    createBudgetDelta(
      "totalTokens",
      "usage",
      current.summary.usage?.totalTokens,
      baseline.summary.usage?.totalTokens,
      policy.usageIncreaseThreshold,
    ),
    createBudgetDelta(
      "costUsd",
      "usage",
      current.summary.usage?.costUsd,
      baseline.summary.usage?.costUsd,
      policy.usageIncreaseThreshold,
    ),
    createBudgetDelta(
      "veryfrontChargeUsd",
      "usage",
      current.summary.usage?.veryfrontChargeUsd,
      baseline.summary.usage?.veryfrontChargeUsd,
      policy.usageIncreaseThreshold,
    ),
    createBudgetDelta(
      "veryfrontBilledUsd",
      "usage",
      current.summary.usage?.veryfrontBilledUsd,
      baseline.summary.usage?.veryfrontBilledUsd,
      policy.usageIncreaseThreshold,
    ),
    createBudgetDelta(
      "costCredits",
      "usage",
      current.summary.usage?.costCredits,
      baseline.summary.usage?.costCredits,
      policy.usageIncreaseThreshold,
    ),
    createBudgetDelta(
      "p95Ms",
      "latency",
      current.summary.duration?.p95Ms,
      baseline.summary.duration?.p95Ms,
      policy.latencyIncreaseThreshold,
    ),
  ].filter((delta): delta is EvalBudgetDeltaSummary => delta !== undefined);
}

function failedExampleIds(report: EvalReport): Set<string> {
  return new Set((report.summary.failedExamples ?? []).map((example) => example.exampleId));
}

function sortedDifference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

/** Compare a current eval report against a saved baseline report. */
export function compareEvalReports(
  current: EvalReport,
  baseline: EvalReport,
  policy: EvalReportComparisonPolicy = {},
): EvalReportComparison {
  const resolvedPolicy = {
    passRateDropThreshold: policy.passRateDropThreshold ?? 0,
    metricPassRateDropThreshold: policy.metricPassRateDropThreshold ?? 0,
    failedDeltaThreshold: policy.failedDeltaThreshold ?? 0,
    usageIncreaseThreshold: policy.usageIncreaseThreshold,
    latencyIncreaseThreshold: policy.latencyIncreaseThreshold,
  };
  const currentMetrics = createMetricIndex(current);
  const baselineMetrics = createMetricIndex(baseline);
  const metricDeltas = createMetricOrder(current, baseline).map((key) =>
    createMetricDelta(key, currentMetrics, baselineMetrics, resolvedPolicy)
  );
  const currentFailedExamples = failedExampleIds(current);
  const baselineFailedExamples = failedExampleIds(baseline);
  const newFailedExamples = sortedDifference(currentFailedExamples, baselineFailedExamples);
  const fixedExamples = sortedDifference(baselineFailedExamples, currentFailedExamples);
  const passRateDelta = current.summary.passRate - baseline.summary.passRate;
  const failedDelta = current.summary.failed - baseline.summary.failed;
  const budgetDeltas = createBudgetDeltas(current, baseline, resolvedPolicy);

  return {
    kind: "eval-report-comparison",
    currentRunId: current.runId,
    baselineRunId: baseline.runId,
    passRateDelta,
    passedDelta: current.summary.passed - baseline.summary.passed,
    failedDelta,
    metricDeltas,
    budgetDeltas,
    newFailedExamples,
    fixedExamples,
    regressed: passRateDelta < -resolvedPolicy.passRateDropThreshold ||
      failedDelta > resolvedPolicy.failedDeltaThreshold ||
      newFailedExamples.length > 0 ||
      metricDeltas.some((metric) => metric.regressed) ||
      budgetDeltas.some((delta) => delta.regressed),
  };
}
