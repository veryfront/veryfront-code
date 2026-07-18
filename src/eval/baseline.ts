import type {
  EvalMetricDeltaSummary,
  EvalMetricSummary,
  EvalReport,
  EvalReportComparison,
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
    throw INVALID_ARGUMENT.create({ detail: `Metric key "${key}" was not present in either report.` });
  }
  return metric;
}

function nullableDelta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : current - baseline;
}

function metricRegressed(
  current: EvalMetricSummary | undefined,
  baseline: EvalMetricSummary | undefined,
): boolean {
  if (!baseline) return false;
  if (!current) return true;
  return current.passRate < baseline.passRate || current.failed > baseline.failed;
}

function createMetricDelta(
  key: string,
  current: Map<string, EvalMetricSummary>,
  baseline: Map<string, EvalMetricSummary>,
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
    regressed: metricRegressed(currentMetric, baselineMetric),
  };
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
): EvalReportComparison {
  const currentMetrics = createMetricIndex(current);
  const baselineMetrics = createMetricIndex(baseline);
  const metricDeltas = createMetricOrder(current, baseline).map((key) =>
    createMetricDelta(key, currentMetrics, baselineMetrics)
  );
  const currentFailedExamples = failedExampleIds(current);
  const baselineFailedExamples = failedExampleIds(baseline);
  const newFailedExamples = sortedDifference(currentFailedExamples, baselineFailedExamples);
  const fixedExamples = sortedDifference(baselineFailedExamples, currentFailedExamples);
  const passRateDelta = current.summary.passRate - baseline.summary.passRate;
  const failedDelta = current.summary.failed - baseline.summary.failed;

  return {
    kind: "eval-report-comparison",
    currentRunId: current.runId,
    baselineRunId: baseline.runId,
    passRateDelta,
    passedDelta: current.summary.passed - baseline.summary.passed,
    failedDelta,
    metricDeltas,
    newFailedExamples,
    fixedExamples,
    regressed: passRateDelta < 0 || failedDelta > 0 || newFailedExamples.length > 0 ||
      metricDeltas.some((metric) => metric.regressed),
  };
}
