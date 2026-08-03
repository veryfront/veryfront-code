import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getEvalArgsSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional(),
    list: v.boolean().default(false),
    datasetBase: v.string().optional(),
    reportDir: v.string().optional(),
    report: v.string().optional(),
    junit: v.string().optional(),
    baseline: v.string().optional(),
    writeBaseline: v.string().optional(),
    baselinePassRateDropThreshold: v.number().min(0).optional(),
    baselineMetricPassRateDropThreshold: v.number().min(0).optional(),
    baselineFailedDeltaThreshold: v.number().min(0).optional(),
    baselineUsageIncreaseThreshold: v.number().min(0).optional(),
    baselineLatencyIncreaseThreshold: v.number().min(0).optional(),
    exporters: v.array(v.string()).default([]),
    requireExport: v.boolean().optional(),
    debug: v.boolean().default(false),
    model: v.string().optional(),
    baselineModel: v.string().optional(),
    candidateModels: v.array(v.string()).default([]),
    comparisonPolicy: v.string().optional(),
    maxOutputTokens: v.number().int().positive().optional(),
  })
);

const EvalArgsSchema = lazySchema(getEvalArgsSchema);

export type EvalArgs = InferSchema<ReturnType<typeof getEvalArgsSchema>>;

export const parseEvalArgs = createArgParser(EvalArgsSchema, {
  id: { keys: ["id"], type: "string", positional: 0 },
  list: { keys: ["list", "l"], type: "boolean" },
  datasetBase: { keys: ["dataset-base"], type: "string" },
  reportDir: { keys: ["report-dir"], type: "string" },
  report: { keys: ["report"], type: "string" },
  junit: { keys: ["junit"], type: "string" },
  baseline: { keys: ["baseline"], type: "string" },
  writeBaseline: { keys: ["write-baseline"], type: "string" },
  baselinePassRateDropThreshold: { keys: ["baseline-pass-rate-drop-threshold"], type: "number" },
  baselineMetricPassRateDropThreshold: {
    keys: ["baseline-metric-pass-rate-drop-threshold"],
    type: "number",
  },
  baselineFailedDeltaThreshold: { keys: ["baseline-failed-delta-threshold"], type: "number" },
  baselineUsageIncreaseThreshold: { keys: ["baseline-usage-increase-threshold"], type: "number" },
  baselineLatencyIncreaseThreshold: {
    keys: ["baseline-latency-increase-threshold"],
    type: "number",
  },
  exporters: { keys: ["export"], type: "array" },
  requireExport: { keys: ["require-export"], type: "boolean" },
  debug: { keys: ["debug"], type: "boolean" },
  model: { keys: ["model"], type: "string" },
  baselineModel: { keys: ["baseline-model"], type: "string" },
  candidateModels: { keys: ["candidate-model", "candidate-models"], type: "array" },
  comparisonPolicy: { keys: ["comparison-policy"], type: "string" },
  maxOutputTokens: { keys: ["max-output-tokens"], type: "number" },
});

export async function handleEvalCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseEvalArgs, "eval", args);
  const { evalCommand } = await import("./command.ts");
  await evalCommand(opts);
}
