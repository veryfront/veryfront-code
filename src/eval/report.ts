import type {
  EvalDefinition,
  EvalMetricResult,
  EvalMetricSummary,
  EvalRecord,
  EvalReport,
  EvalReportSummary,
} from "./types.ts";

function isBlockingFailure(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function recordPassed(record: EvalRecord): boolean {
  if (!record.completed || record.error) return false;
  const results = [...(record.metrics ?? []), ...(record.checks ?? [])];
  return results.every((result) => !isBlockingFailure(result));
}

function summarizeMetricResults(records: EvalRecord[]): EvalMetricSummary[] {
  const summaries = new Map<string, EvalMetricSummary>();

  for (const record of records) {
    for (const result of [...(record.metrics ?? []), ...(record.checks ?? [])]) {
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
  return {
    records: records.length,
    passed,
    failed,
    passRate: records.length === 0 ? 1 : passed / records.length,
    metrics: summarizeMetricResults(records),
  };
}

/** Create a JSON-serializable eval report from executed records. */
export function createEvalReport(input: {
  definition: EvalDefinition;
  records: EvalRecord[];
  runId: string;
  startedAt: Date;
  endedAt: Date;
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
  };
}
