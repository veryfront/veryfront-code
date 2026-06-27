import { compareEvalReports } from "./baseline.ts";
import type {
  EvalMetricResult,
  EvalModelCandidateComparison,
  EvalModelComparison,
  EvalModelComparisonOptions,
  EvalModelReportSummary,
  EvalReport,
} from "./types.ts";

const DEFAULT_MIN_GROUNDEDNESS = 0.8;
const DEFAULT_MIN_EFFICIENCY_IMPROVEMENT = 0.1;

function reportModel(report: EvalReport): string {
  return report.metadata?.model ?? report.runId;
}

function failedExampleIds(report: EvalReport): string[] {
  return (report.summary.failedExamples ?? []).map((example) => example.exampleId).sort();
}

function allMetricResults(report: EvalReport): EvalMetricResult[] {
  return report.records.flatMap((record) => [...(record.metrics ?? []), ...(record.checks ?? [])]);
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricPassRate(report: EvalReport, metricName: string): number | undefined {
  return report.summary.metrics.find((metric) => metric.name === metricName)?.passRate;
}

function groundednessScore(report: EvalReport): number | undefined {
  return average(
    allMetricResults(report)
      .filter((result) => result.name === "answer.groundedness" && result.score !== undefined)
      .map((result) => result.score!),
  ) ?? metricPassRate(report, "answer.groundedness");
}

function improvementPct(
  baseline: number | undefined,
  candidate: number | undefined,
): number | undefined {
  if (baseline === undefined || candidate === undefined || baseline <= 0) return undefined;
  return (baseline - candidate) / baseline;
}

function meetsImprovement(value: number | undefined, threshold: number): boolean {
  return value !== undefined && value >= threshold;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function modelSummary(
  report: EvalReport,
  baselineModel: string,
): EvalModelReportSummary {
  const model = reportModel(report);
  const groundedness = groundednessScore(report);
  return {
    model,
    role: model === baselineModel ? "baseline" : "candidate",
    runId: report.runId,
    passed: report.summary.passed,
    failed: report.summary.failed,
    passRate: report.summary.passRate,
    failedExamples: failedExampleIds(report),
    gateFailures: report.summary.gateFailures?.length ?? 0,
    ...(report.summary.usage?.totalTokens !== undefined
      ? { totalTokens: report.summary.usage.totalTokens }
      : {}),
    ...(report.summary.usage?.costUsd !== undefined
      ? { costUsd: report.summary.usage.costUsd }
      : {}),
    ...(report.summary.duration?.p95Ms !== undefined
      ? { p95Ms: report.summary.duration.p95Ms }
      : {}),
    ...(groundedness !== undefined ? { groundednessScore: groundedness } : {}),
  };
}

function createCandidateDecision(input: {
  candidate: EvalReport;
  baseline: EvalReport;
  options: Required<EvalModelComparisonOptions>;
}): Pick<EvalModelCandidateComparison, "decision" | "reasons"> {
  const baselineModel = input.options.baselineModel;
  const baselineSummary = modelSummary(input.baseline, baselineModel);
  const candidateSummary = modelSummary(input.candidate, baselineModel);
  const baselineComparison = compareEvalReports(input.candidate, input.baseline);
  const reasons: string[] = [];

  if (
    input.candidate.summary.failed > 0 || baselineComparison.regressed ||
    baselineComparison.newFailedExamples.length > 0
  ) {
    reasons.push("candidate has quality regressions");
    if (baselineComparison.newFailedExamples.length > 0) {
      reasons.push(`new failed examples: ${baselineComparison.newFailedExamples.join(", ")}`);
    }
    return { decision: "keep-baseline", reasons };
  }

  reasons.push("candidate has no quality regressions");

  if (
    candidateSummary.groundednessScore !== undefined &&
    candidateSummary.groundednessScore < input.options.minGroundedness
  ) {
    reasons.push(`groundedness is below ${input.options.minGroundedness}`);
    return { decision: "keep-baseline", reasons };
  }

  if (candidateSummary.groundednessScore === undefined) {
    reasons.push("groundedness was not measured");
  } else {
    reasons.push(`groundedness is at or above ${input.options.minGroundedness}`);
  }

  const costImprovement = improvementPct(baselineSummary.costUsd, candidateSummary.costUsd);
  const tokenImprovement = improvementPct(
    baselineSummary.totalTokens,
    candidateSummary.totalTokens,
  );
  const latencyImprovement = improvementPct(baselineSummary.p95Ms, candidateSummary.p95Ms);

  if (meetsImprovement(costImprovement, input.options.minCostImprovementPct)) {
    reasons.push(`cost improved by ${formatPct(costImprovement!)}`);
    return { decision: "promote-candidate", reasons };
  }
  if (meetsImprovement(tokenImprovement, input.options.minTokenImprovementPct)) {
    reasons.push(`tokens improved by ${formatPct(tokenImprovement!)}`);
    return { decision: "promote-candidate", reasons };
  }
  if (meetsImprovement(latencyImprovement, input.options.minLatencyImprovementPct)) {
    reasons.push(`p95 latency improved by ${formatPct(latencyImprovement!)}`);
    return { decision: "promote-candidate", reasons };
  }

  reasons.push("no cost, token, or latency improvement could be measured");
  return { decision: "needs-review", reasons };
}

function compareCandidate(
  candidate: EvalReport,
  baseline: EvalReport,
  options: Required<EvalModelComparisonOptions>,
): EvalModelCandidateComparison {
  const baselineComparison = compareEvalReports(candidate, baseline);
  const candidateSummary = modelSummary(candidate, options.baselineModel);
  const baselineSummary = modelSummary(baseline, options.baselineModel);
  const decision = createCandidateDecision({ candidate, baseline, options });
  const costImprovement = improvementPct(baselineSummary.costUsd, candidateSummary.costUsd);
  const tokenImprovement = improvementPct(
    baselineSummary.totalTokens,
    candidateSummary.totalTokens,
  );
  const latencyImprovement = improvementPct(baselineSummary.p95Ms, candidateSummary.p95Ms);

  return {
    model: reportModel(candidate),
    baselineModel: options.baselineModel,
    passRateDelta: baselineComparison.passRateDelta,
    failedDelta: baselineComparison.failedDelta,
    newFailedExamples: baselineComparison.newFailedExamples,
    ...(candidateSummary.groundednessScore !== undefined
      ? { groundednessScore: candidateSummary.groundednessScore }
      : {}),
    ...(costImprovement !== undefined ? { costImprovementPct: costImprovement } : {}),
    ...(tokenImprovement !== undefined ? { tokenImprovementPct: tokenImprovement } : {}),
    ...(latencyImprovement !== undefined ? { latencyImprovementPct: latencyImprovement } : {}),
    decision: decision.decision,
    reasons: decision.reasons,
  };
}

function pickRecommendation(
  candidates: EvalModelCandidateComparison[],
): EvalModelComparison["recommendation"] {
  const promotable = candidates.find((candidate) => candidate.decision === "promote-candidate");
  if (promotable) {
    return {
      decision: "promote-candidate",
      model: promotable.model,
      reasons: promotable.reasons,
    };
  }

  const needsReview = candidates.find((candidate) => candidate.decision === "needs-review");
  if (needsReview) {
    return {
      decision: "needs-review",
      model: needsReview.model,
      reasons: needsReview.reasons,
    };
  }

  const firstCandidate = candidates[0];
  return {
    decision: "keep-baseline",
    ...(firstCandidate ? { model: firstCandidate.model } : {}),
    reasons: firstCandidate?.reasons ?? ["no candidate models were compared"],
  };
}

function normalizeOptions(
  options: EvalModelComparisonOptions,
): Required<EvalModelComparisonOptions> {
  return {
    baselineModel: options.baselineModel,
    minGroundedness: options.minGroundedness ?? DEFAULT_MIN_GROUNDEDNESS,
    minCostImprovementPct: options.minCostImprovementPct ?? DEFAULT_MIN_EFFICIENCY_IMPROVEMENT,
    minTokenImprovementPct: options.minTokenImprovementPct ?? DEFAULT_MIN_EFFICIENCY_IMPROVEMENT,
    minLatencyImprovementPct: options.minLatencyImprovementPct ??
      DEFAULT_MIN_EFFICIENCY_IMPROVEMENT,
  };
}

/** Compare eval reports from multiple models using conservative promotion rules. */
export function compareEvalModelReports(
  reports: EvalReport[],
  options: EvalModelComparisonOptions,
): EvalModelComparison {
  const normalized = normalizeOptions(options);
  const baseline = reports.find((report) => reportModel(report) === normalized.baselineModel);
  if (!baseline) {
    throw new Error(
      `Baseline model "${normalized.baselineModel}" was not present in eval reports.`,
    );
  }

  const candidates = reports
    .filter((report) => reportModel(report) !== normalized.baselineModel)
    .map((report) => compareCandidate(report, baseline, normalized));

  return {
    kind: "eval-model-comparison",
    baselineModel: normalized.baselineModel,
    candidateModels: candidates.map((candidate) => candidate.model),
    models: reports.map((report) => modelSummary(report, normalized.baselineModel)),
    candidates,
    recommendation: pickRecommendation(candidates),
  };
}

function numberCell(value: number | undefined): string {
  return value === undefined ? "-" : String(Math.round(value));
}

function decimalCell(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(2);
}

/** Render a human-reviewable markdown summary for a model comparison report. */
export function createEvalModelComparisonMarkdown(comparison: EvalModelComparison): string {
  const lines = [
    "# Eval Model Comparison",
    "",
    `Baseline: ${comparison.baselineModel}`,
    `Candidates: ${comparison.candidateModels.join(", ") || "-"}`,
    `Recommendation: ${comparison.recommendation.decision}${
      comparison.recommendation.model ? ` (${comparison.recommendation.model})` : ""
    }`,
    "",
    "## Models",
    "",
    "| Model | Role | Passed | Failed | Pass rate | Groundedness | Tokens | Cost USD | p95 ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const model of comparison.models) {
    lines.push(
      `| ${model.model} | ${model.role} | ${model.passed} | ${model.failed} | ${
        Math.round(model.passRate * 100)
      }% | ${decimalCell(model.groundednessScore)} | ${numberCell(model.totalTokens)} | ${
        decimalCell(model.costUsd)
      } | ${numberCell(model.p95Ms)} |`,
    );
  }

  lines.push("", "## Decision", "");
  for (const reason of comparison.recommendation.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
  return `${lines.join("\n")}`;
}
