import { compareEvalReports } from "./baseline.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type {
  EvalMetricResult,
  EvalModelCandidateComparison,
  EvalModelComparison,
  EvalModelComparisonMetricName,
  EvalModelComparisonOptions,
  EvalModelReportSummary,
  EvalReport,
} from "./types.ts";
import {
  assertFiniteEvalNumber,
  createEvalValidationError,
  isEvalRecord,
  normalizeEvalString,
} from "./validation.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const DEFAULT_MIN_GROUNDEDNESS = 0.8;
const DEFAULT_MIN_EFFICIENCY_IMPROVEMENT = 0.1;

type NormalizedEvalModelComparisonOptions =
  & Required<
    Pick<
      EvalModelComparisonOptions,
      | "baselineModel"
      | "minGroundedness"
      | "minCostImprovementPct"
      | "minTokenImprovementPct"
      | "minLatencyImprovementPct"
    >
  >
  & Pick<EvalModelComparisonOptions, "constraints" | "objectives">;

const LOWER_IS_BETTER = new Set<EvalModelComparisonMetricName>([
  "failed",
  "gateFailures",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "billableInputTokens",
  "billableOutputTokens",
  "costUsd",
  "providerInputCostUsd",
  "providerOutputCostUsd",
  "providerCostUsd",
  "veryfrontInputChargeUsd",
  "veryfrontOutputChargeUsd",
  "veryfrontChargeUsd",
  "veryfrontBilledUsd",
  "costCredits",
  "p95Ms",
]);
const MODEL_COMPARISON_METRICS = new Set<EvalModelComparisonMetricName>([
  "passRate",
  "groundednessScore",
  ...LOWER_IS_BETTER,
]);

function reportModel(report: EvalReport): string {
  const model = report.metadata?.model?.trim();
  return model || report.runId;
}

function failedExampleIds(report: EvalReport): string[] {
  return (report.summary.failedExamples ?? []).map((example) => example.exampleId).sort(
    compareStrings,
  );
}

function allMetricResults(report: EvalReport): EvalMetricResult[] {
  return report.records.flatMap((record) => [...(record.metrics ?? []), ...(record.checks ?? [])]);
}

function average(values: number[]): number | undefined {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) return undefined;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function metricPassRate(report: EvalReport, metricName: string): number | undefined {
  const value = report.summary.metrics.find((metric) => metric.name === metricName)?.passRate;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
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

function formatScore(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}

function comparisonCost(summary: EvalModelReportSummary): number | undefined {
  return summary.veryfrontChargeUsd ?? summary.veryfrontBilledUsd ?? summary.costUsd ??
    summary.providerCostUsd;
}

function defaultCostComparison(
  baselineSummary: EvalModelReportSummary,
  candidateSummary: EvalModelReportSummary,
): { baseline: number; candidate: number; label: string } | undefined {
  if (
    baselineSummary.veryfrontChargeUsd !== undefined &&
    candidateSummary.veryfrontChargeUsd !== undefined
  ) {
    return {
      baseline: baselineSummary.veryfrontChargeUsd,
      candidate: candidateSummary.veryfrontChargeUsd,
      label: "Veryfront metered cost",
    };
  }
  if (
    baselineSummary.veryfrontBilledUsd !== undefined &&
    candidateSummary.veryfrontBilledUsd !== undefined
  ) {
    return {
      baseline: baselineSummary.veryfrontBilledUsd,
      candidate: candidateSummary.veryfrontBilledUsd,
      label: "Veryfront billed cost",
    };
  }
  if (baselineSummary.costUsd !== undefined && candidateSummary.costUsd !== undefined) {
    return {
      baseline: baselineSummary.costUsd,
      candidate: candidateSummary.costUsd,
      label: "cost",
    };
  }
  if (
    baselineSummary.providerCostUsd !== undefined &&
    candidateSummary.providerCostUsd !== undefined
  ) {
    return {
      baseline: baselineSummary.providerCostUsd,
      candidate: candidateSummary.providerCostUsd,
      label: "provider cost",
    };
  }
  if (
    baselineSummary.costSource === "gateway" &&
    candidateSummary.costSource === "gateway" &&
    baselineSummary.costCredits !== undefined &&
    candidateSummary.costCredits !== undefined
  ) {
    return {
      baseline: baselineSummary.costCredits,
      candidate: candidateSummary.costCredits,
      label: "Veryfront credits",
    };
  }
  return undefined;
}

function metricValue(
  summary: EvalModelReportSummary,
  metric: EvalModelComparisonMetricName,
): number | undefined {
  let value: number | undefined;
  switch (metric) {
    case "passRate":
      value = summary.passRate;
      break;
    case "failed":
      value = summary.failed;
      break;
    case "gateFailures":
      value = summary.gateFailures;
      break;
    case "groundednessScore":
      value = summary.groundednessScore;
      break;
    case "inputTokens":
      value = summary.inputTokens;
      break;
    case "outputTokens":
      value = summary.outputTokens;
      break;
    case "totalTokens":
      value = summary.totalTokens;
      break;
    case "billableInputTokens":
      value = summary.billableInputTokens;
      break;
    case "billableOutputTokens":
      value = summary.billableOutputTokens;
      break;
    case "costUsd":
      value = comparisonCost(summary);
      break;
    case "providerInputCostUsd":
      value = summary.providerInputCostUsd;
      break;
    case "providerOutputCostUsd":
      value = summary.providerOutputCostUsd;
      break;
    case "providerCostUsd":
      value = summary.providerCostUsd;
      break;
    case "veryfrontInputChargeUsd":
      value = summary.veryfrontInputChargeUsd;
      break;
    case "veryfrontOutputChargeUsd":
      value = summary.veryfrontOutputChargeUsd;
      break;
    case "veryfrontChargeUsd":
      value = summary.veryfrontChargeUsd;
      break;
    case "veryfrontBilledUsd":
      value = summary.veryfrontBilledUsd;
      break;
    case "costCredits":
      value = summary.costCredits;
      break;
    case "p95Ms":
      value = summary.p95Ms;
      break;
  }
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function regressionPct(input: {
  baseline: number;
  candidate: number;
  lowerIsBetter: boolean;
}): number {
  const worsenedBy = input.lowerIsBetter
    ? input.candidate - input.baseline
    : input.baseline - input.candidate;
  if (worsenedBy <= 0) return 0;
  if (input.baseline === 0) return Number.POSITIVE_INFINITY;
  return worsenedBy / Math.abs(input.baseline);
}

function objectiveDelta(input: {
  baseline: number;
  candidate: number;
  direction: "minimize" | "maximize";
}): number {
  const delta = input.direction === "minimize"
    ? input.baseline - input.candidate
    : input.candidate - input.baseline;
  if (input.baseline === 0) {
    if (delta === 0) return 0;
    return delta / Math.max(Math.abs(input.candidate), 1);
  }
  return delta / Math.abs(input.baseline);
}

function evaluateConstraints(input: {
  baselineSummary: EvalModelReportSummary;
  candidateSummary: EvalModelReportSummary;
  options: NormalizedEvalModelComparisonOptions;
}): string[] {
  const failures: string[] = [];
  for (
    const [metric, constraint] of Object.entries(input.options.constraints ?? {}) as [
      EvalModelComparisonMetricName,
      NonNullable<EvalModelComparisonOptions["constraints"]>[EvalModelComparisonMetricName],
    ][]
  ) {
    if (!constraint) continue;
    const candidateValue = metricValue(input.candidateSummary, metric);
    if (candidateValue === undefined) {
      failures.push(`${metric} was not measured`);
      continue;
    }
    if (constraint.min !== undefined && candidateValue < constraint.min) {
      failures.push(`${metric} ${candidateValue} is below the required ${constraint.min}`);
    }
    if (constraint.max !== undefined && candidateValue > constraint.max) {
      failures.push(`${metric} ${candidateValue} is above the allowed ${constraint.max}`);
    }
    if (constraint.maxRegressionPct !== undefined) {
      const baselineValue = metricValue(input.baselineSummary, metric);
      if (baselineValue === undefined) {
        failures.push(`${metric} baseline was not measured`);
        continue;
      }
      const regression = regressionPct({
        baseline: baselineValue,
        candidate: candidateValue,
        lowerIsBetter: LOWER_IS_BETTER.has(metric),
      });
      if (regression > constraint.maxRegressionPct) {
        failures.push(
          `${metric} regressed by ${formatPct(regression)}, above the allowed ${
            formatPct(constraint.maxRegressionPct)
          }`,
        );
      }
    }
  }
  return failures;
}

function evaluateObjectiveScore(input: {
  baselineSummary: EvalModelReportSummary;
  candidateSummary: EvalModelReportSummary;
  options: NormalizedEvalModelComparisonOptions;
}): { score?: number; missing: string[] } {
  const objectives = Object.entries(input.options.objectives ?? {}) as [
    EvalModelComparisonMetricName,
    NonNullable<EvalModelComparisonOptions["objectives"]>[EvalModelComparisonMetricName],
  ][];
  if (objectives.length === 0) return { missing: [] };

  const missing: string[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const [metric, objective] of objectives) {
    if (!objective || objective.weight <= 0) continue;
    const baselineValue = metricValue(input.baselineSummary, metric);
    const candidateValue = metricValue(input.candidateSummary, metric);
    if (baselineValue === undefined || candidateValue === undefined) {
      missing.push(metric);
      continue;
    }
    weightedScore += objective.weight *
      objectiveDelta({
        baseline: baselineValue,
        candidate: candidateValue,
        direction: objective.direction,
      });
    totalWeight += objective.weight;
  }

  if (missing.length > 0 || totalWeight === 0) {
    return { missing };
  }
  return { score: formatScore(weightedScore / totalWeight), missing: [] };
}

function hasBlockingRegression(
  comparison: ReturnType<typeof compareEvalReports>,
): boolean {
  return comparison.passRateDelta < 0 || comparison.failedDelta > 0 ||
    comparison.newFailedExamples.length > 0 ||
    comparison.metricDeltas.some((metric) => metric.severity !== "soft" && metric.regressed);
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
    ...(report.summary.usage?.inputTokens !== undefined
      ? { inputTokens: report.summary.usage.inputTokens }
      : {}),
    ...(report.summary.usage?.outputTokens !== undefined
      ? { outputTokens: report.summary.usage.outputTokens }
      : {}),
    ...(report.summary.usage?.totalTokens !== undefined
      ? { totalTokens: report.summary.usage.totalTokens }
      : {}),
    ...(report.summary.usage?.billableInputTokens !== undefined
      ? { billableInputTokens: report.summary.usage.billableInputTokens }
      : {}),
    ...(report.summary.usage?.billableOutputTokens !== undefined
      ? { billableOutputTokens: report.summary.usage.billableOutputTokens }
      : {}),
    ...(report.summary.usage?.costUsd !== undefined
      ? { costUsd: report.summary.usage.costUsd }
      : {}),
    ...(report.summary.usage?.providerInputCostUsd !== undefined
      ? { providerInputCostUsd: report.summary.usage.providerInputCostUsd }
      : {}),
    ...(report.summary.usage?.providerOutputCostUsd !== undefined
      ? { providerOutputCostUsd: report.summary.usage.providerOutputCostUsd }
      : {}),
    ...(report.summary.usage?.providerCostUsd !== undefined
      ? { providerCostUsd: report.summary.usage.providerCostUsd }
      : {}),
    ...(report.summary.usage?.veryfrontInputChargeUsd !== undefined
      ? { veryfrontInputChargeUsd: report.summary.usage.veryfrontInputChargeUsd }
      : {}),
    ...(report.summary.usage?.veryfrontOutputChargeUsd !== undefined
      ? { veryfrontOutputChargeUsd: report.summary.usage.veryfrontOutputChargeUsd }
      : {}),
    ...(report.summary.usage?.veryfrontChargeUsd !== undefined
      ? { veryfrontChargeUsd: report.summary.usage.veryfrontChargeUsd }
      : {}),
    ...(report.summary.usage?.veryfrontBilledUsd !== undefined
      ? { veryfrontBilledUsd: report.summary.usage.veryfrontBilledUsd }
      : {}),
    ...(report.summary.usage?.costCredits !== undefined
      ? { costCredits: report.summary.usage.costCredits }
      : {}),
    ...(report.summary.usage?.costSource !== undefined
      ? { costSource: report.summary.usage.costSource }
      : {}),
    ...(report.summary.usage?.billingMode !== undefined
      ? { billingMode: report.summary.usage.billingMode }
      : {}),
    ...(report.summary.usage?.usageCaptureStatus !== undefined
      ? { usageCaptureStatus: report.summary.usage.usageCaptureStatus }
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
  options: NormalizedEvalModelComparisonOptions;
}): Pick<
  EvalModelCandidateComparison,
  "constraintFailures" | "decision" | "objectiveScore" | "reasons"
> {
  const baselineModel = input.options.baselineModel;
  const baselineSummary = modelSummary(input.baseline, baselineModel);
  const candidateSummary = modelSummary(input.candidate, baselineModel);
  const baselineComparison = compareEvalReports(input.candidate, input.baseline);
  const reasons: string[] = [];

  if (
    input.candidate.summary.failed > 0 || hasBlockingRegression(baselineComparison) ||
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

  const constraintFailures = evaluateConstraints({
    baselineSummary,
    candidateSummary,
    options: input.options,
  });
  if (constraintFailures.length > 0) {
    reasons.push("candidate failed configured constraints");
    return { constraintFailures, decision: "keep-baseline", reasons };
  }

  if (Object.keys(input.options.objectives ?? {}).length > 0) {
    const objective = evaluateObjectiveScore({
      baselineSummary,
      candidateSummary,
      options: input.options,
    });
    if (objective.missing.length > 0 || objective.score === undefined) {
      reasons.push(`objectives could not be measured: ${objective.missing.join(", ") || "none"}`);
      return { decision: "needs-review", reasons };
    }
    reasons.push(`weighted objective score: ${objective.score}`);
    if (objective.score > 0) {
      return { decision: "promote-candidate", objectiveScore: objective.score, reasons };
    }
    if (objective.score < 0) {
      return { decision: "keep-baseline", objectiveScore: objective.score, reasons };
    }
    return { decision: "needs-review", objectiveScore: objective.score, reasons };
  }

  const costComparison = defaultCostComparison(baselineSummary, candidateSummary);
  const costImprovement = improvementPct(costComparison?.baseline, costComparison?.candidate);
  const tokenImprovement = improvementPct(
    baselineSummary.totalTokens,
    candidateSummary.totalTokens,
  );
  const latencyImprovement = improvementPct(baselineSummary.p95Ms, candidateSummary.p95Ms);

  if (
    costComparison !== undefined && costImprovement !== undefined && costImprovement < 0
  ) {
    reasons.push(
      `${costComparison.label} regressed by ${formatPct(Math.abs(costImprovement))}`,
    );
    return { decision: "needs-review", reasons };
  }

  if (meetsImprovement(costImprovement, input.options.minCostImprovementPct)) {
    reasons.push(
      `${costComparison!.label} improved by ${formatPct(costImprovement!)}`,
    );
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
  options: NormalizedEvalModelComparisonOptions,
): EvalModelCandidateComparison {
  const baselineComparison = compareEvalReports(candidate, baseline);
  const candidateSummary = modelSummary(candidate, options.baselineModel);
  const baselineSummary = modelSummary(baseline, options.baselineModel);
  const decision = createCandidateDecision({ candidate, baseline, options });
  const costComparison = defaultCostComparison(baselineSummary, candidateSummary);
  const costImprovement = improvementPct(costComparison?.baseline, costComparison?.candidate);
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
    ...(decision.constraintFailures && decision.constraintFailures.length > 0
      ? { constraintFailures: decision.constraintFailures }
      : {}),
    ...(decision.objectiveScore !== undefined ? { objectiveScore: decision.objectiveScore } : {}),
    decision: decision.decision,
    reasons: decision.reasons,
  };
}

function pickRecommendation(
  candidates: EvalModelCandidateComparison[],
): EvalModelComparison["recommendation"] {
  const promotable = candidates.filter((candidate) => candidate.decision === "promote-candidate");
  if (promotable.length === 1) {
    const candidate = promotable[0];
    if (candidate) {
      return {
        decision: "promote-candidate",
        model: candidate.model,
        reasons: candidate.reasons,
      };
    }
  }
  if (promotable.length > 1) {
    const scoredPromotable = promotable
      .filter((candidate) => candidate.objectiveScore !== undefined)
      .sort((a, b) => (b.objectiveScore ?? 0) - (a.objectiveScore ?? 0))[0];
    if (scoredPromotable) {
      return {
        decision: "promote-candidate",
        model: scoredPromotable.model,
        reasons: scoredPromotable.reasons,
      };
    }
    return {
      decision: "promote-candidate",
      reasons: [
        `multiple candidate models are promotable: ${
          promotable.map((candidate) => candidate.model).join(", ")
        }`,
        "configure --comparison-policy objectives to rank candidates by your product requirements",
      ],
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
): NormalizedEvalModelComparisonOptions {
  if (!isEvalRecord(options)) {
    throw createEvalValidationError("Eval model comparison options must be an object");
  }
  const normalizedOptions = options as EvalModelComparisonOptions;
  const baselineModel = normalizeEvalString(
    normalizedOptions.baselineModel,
    "Eval model comparison baselineModel",
  );
  const minGroundedness = normalizedOptions.minGroundedness ?? DEFAULT_MIN_GROUNDEDNESS;
  const minCostImprovementPct = normalizedOptions.minCostImprovementPct ??
    DEFAULT_MIN_EFFICIENCY_IMPROVEMENT;
  const minTokenImprovementPct = normalizedOptions.minTokenImprovementPct ??
    DEFAULT_MIN_EFFICIENCY_IMPROVEMENT;
  const minLatencyImprovementPct = normalizedOptions.minLatencyImprovementPct ??
    DEFAULT_MIN_EFFICIENCY_IMPROVEMENT;
  assertFiniteEvalNumber(minGroundedness, "Eval model comparison minGroundedness", {
    min: 0,
    max: 1,
  });
  for (
    const [label, value] of [
      ["minCostImprovementPct", minCostImprovementPct],
      ["minTokenImprovementPct", minTokenImprovementPct],
      ["minLatencyImprovementPct", minLatencyImprovementPct],
    ] as const
  ) {
    assertFiniteEvalNumber(value, `Eval model comparison ${label}`, { min: 0, max: 1 });
  }

  const constraints = normalizeConstraints(normalizedOptions.constraints);
  const objectives = normalizeObjectives(normalizedOptions.objectives);
  return {
    baselineModel,
    minGroundedness,
    minCostImprovementPct,
    minTokenImprovementPct,
    minLatencyImprovementPct,
    ...(constraints ? { constraints } : {}),
    ...(objectives ? { objectives } : {}),
  };
}

function normalizeConstraints(
  constraints: EvalModelComparisonOptions["constraints"],
): EvalModelComparisonOptions["constraints"] {
  if (constraints === undefined) return undefined;
  if (!isEvalRecord(constraints)) {
    throw createEvalValidationError("Eval model comparison constraints must be an object");
  }
  const normalized: NonNullable<EvalModelComparisonOptions["constraints"]> = {};
  for (const [metric, rawConstraint] of Object.entries(constraints)) {
    if (!MODEL_COMPARISON_METRICS.has(metric as EvalModelComparisonMetricName)) {
      throw createEvalValidationError(`Unknown eval model comparison constraint "${metric}"`);
    }
    if (!isEvalRecord(rawConstraint)) {
      throw createEvalValidationError(
        `Eval model comparison constraint "${metric}" must be an object`,
      );
    }
    const constraint = rawConstraint as {
      min?: number;
      max?: number;
      maxRegressionPct?: number;
    };
    if (constraint.min !== undefined) {
      assertFiniteEvalNumber(constraint.min, `${metric} constraint min`);
    }
    if (constraint.max !== undefined) {
      assertFiniteEvalNumber(constraint.max, `${metric} constraint max`);
    }
    if (constraint.maxRegressionPct !== undefined) {
      assertFiniteEvalNumber(
        constraint.maxRegressionPct,
        `${metric} constraint maxRegressionPct`,
        { min: 0 },
      );
    }
    if (
      constraint.min !== undefined && constraint.max !== undefined &&
      constraint.min > constraint.max
    ) {
      throw createEvalValidationError(`${metric} constraint min cannot exceed max`);
    }
    normalized[metric as EvalModelComparisonMetricName] = { ...constraint };
  }
  return normalized;
}

function normalizeObjectives(
  objectives: EvalModelComparisonOptions["objectives"],
): EvalModelComparisonOptions["objectives"] {
  if (objectives === undefined) return undefined;
  if (!isEvalRecord(objectives)) {
    throw createEvalValidationError("Eval model comparison objectives must be an object");
  }
  const normalized: NonNullable<EvalModelComparisonOptions["objectives"]> = {};
  for (const [metric, rawObjective] of Object.entries(objectives)) {
    if (!MODEL_COMPARISON_METRICS.has(metric as EvalModelComparisonMetricName)) {
      throw createEvalValidationError(`Unknown eval model comparison objective "${metric}"`);
    }
    if (!isEvalRecord(rawObjective)) {
      throw createEvalValidationError(
        `Eval model comparison objective "${metric}" must be an object`,
      );
    }
    const objective = rawObjective as { weight?: number; direction?: unknown };
    assertFiniteEvalNumber(objective.weight, `${metric} objective weight`, { min: 0 });
    if (objective.direction !== "minimize" && objective.direction !== "maximize") {
      throw createEvalValidationError(
        `${metric} objective direction must be "minimize" or "maximize"`,
      );
    }
    normalized[metric as EvalModelComparisonMetricName] = {
      weight: objective.weight,
      direction: objective.direction,
    };
  }
  return normalized;
}

/** Compare eval reports from multiple models using conservative promotion rules. */
export function compareEvalModelReports(
  reports: EvalReport[],
  options: EvalModelComparisonOptions,
): EvalModelComparison {
  const normalized = normalizeOptions(options);
  const reportsByModel = new Map<string, EvalReport[]>();
  for (const report of reports) {
    const model = reportModel(report);
    const matches = reportsByModel.get(model) ?? [];
    matches.push(report);
    reportsByModel.set(model, matches);
  }
  const duplicates = [...reportsByModel.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([model]) => model)
    .sort(compareStrings);
  if (duplicates.length > 0) {
    throw INVALID_ARGUMENT.create({
      detail: `Duplicate eval model report(s): ${duplicates.join(", ")}`,
    });
  }
  const baseline = reportsByModel.get(normalized.baselineModel)?.[0];
  if (!baseline) {
    throw INVALID_ARGUMENT.create({
      detail: `Baseline model "${normalized.baselineModel}" was not present in eval reports.`,
    });
  }

  const candidates = reports
    .filter((report) => reportModel(report) !== normalized.baselineModel)
    .map((report) => compareCandidate(report, baseline, normalized));
  if (candidates.length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Eval model comparison requires at least one candidate model report.",
    });
  }

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

function costCell(
  value: number | undefined,
  costSource: EvalModelReportSummary["costSource"],
): string {
  if (value !== undefined) {
    const absolute = Math.abs(value);
    if (absolute >= 0.01) return value.toFixed(2);
    return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  }
  return costSource === "gateway" ? "-" : "not measured";
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
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
    "| Model | Role | Passed | Failed | Pass rate | Groundedness | Input tok | Output tok | Total tok | Billable in | Billable out | Provider in USD | Provider out USD | Provider USD | Metered in USD | Metered out USD | Metered USD | Billed USD | Credits | Cost source | Billing mode | p95 ms |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |",
  ];

  for (const model of comparison.models) {
    lines.push(
      `| ${model.model} | ${model.role} | ${model.passed} | ${model.failed} | ${
        Math.round(model.passRate * 100)
      }% | ${decimalCell(model.groundednessScore)} | ${numberCell(model.inputTokens)} | ${
        numberCell(model.outputTokens)
      } | ${numberCell(model.totalTokens)} | ${numberCell(model.billableInputTokens)} | ${
        numberCell(model.billableOutputTokens)
      } | ${costCell(model.providerInputCostUsd, model.costSource)} | ${
        costCell(model.providerOutputCostUsd, model.costSource)
      } | ${costCell(model.providerCostUsd ?? model.costUsd, model.costSource)} | ${
        costCell(model.veryfrontInputChargeUsd, model.costSource)
      } | ${costCell(model.veryfrontOutputChargeUsd, model.costSource)} | ${
        costCell(model.veryfrontChargeUsd, model.costSource)
      } | ${costCell(model.veryfrontBilledUsd, model.costSource)} | ${
        decimalCell(model.costCredits)
      } | ${model.costSource ?? "-"} | ${model.billingMode ?? "-"} | ${numberCell(model.p95Ms)} |`,
    );
  }

  lines.push(
    "",
    "_Model optimization uses Metered USD by default: the token-metered Veryfront charge before billing minimums. Billed USD and Credits include gateway request minimums and show actual billed eval cost._",
  );

  if (comparison.candidates.length > 0) {
    lines.push(
      "",
      "## Candidates",
      "",
      "| Model | Decision | Objective score | Constraint failures |",
      "| --- | --- | ---: | --- |",
    );
    for (const candidate of comparison.candidates) {
      const constraintFailures = candidate.constraintFailures?.length
        ? candidate.constraintFailures.map(markdownCell).join("; ")
        : "-";
      lines.push(
        `| ${markdownCell(candidate.model)} | ${candidate.decision} | ${
          decimalCell(candidate.objectiveScore)
        } | ${constraintFailures} |`,
      );
    }
  }

  lines.push("", "## Decision", "");
  for (const reason of comparison.recommendation.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push("");
  return `${lines.join("\n")}`;
}
