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
    exporters: v.array(v.string()).default([]),
    debug: v.boolean().default(false),
    model: v.string().optional(),
    baselineModel: v.string().optional(),
    candidateModels: v.array(v.string()).default([]),
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
  exporters: { keys: ["export"], type: "array" },
  debug: { keys: ["debug"], type: "boolean" },
  model: { keys: ["model"], type: "string" },
  baselineModel: { keys: ["baseline-model"], type: "string" },
  candidateModels: { keys: ["candidate-model", "candidate-models"], type: "array" },
  maxOutputTokens: { keys: ["max-output-tokens"], type: "number" },
});

export async function handleEvalCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseEvalArgs, "eval", args);
  const { evalCommand } = await import("./command.ts");
  await evalCommand(opts);
}
