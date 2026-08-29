import { datasets } from "./datasets.ts";
import type {
  EvalAgentInput,
  EvalDataset,
  EvalDatasetInput,
  EvalDefinition,
  EvalExampleInput,
  EvalMetric,
  EvalTargetKind,
  EvalToolInput,
} from "./types.ts";
import {
  assertFiniteEvalNumber,
  createEvalValidationError,
  isEvalArray,
  isEvalRecord,
  normalizeEvalString,
  normalizeEvalStringList,
} from "./validation.ts";

const EVAL_DATASET_KINDS = new Set<EvalDataset["kind"]>(["inline", "json", "jsonl"]);
const EVAL_METRIC_FAMILIES = new Set<EvalMetric["family"]>([
  "answer",
  "agent",
  "ops",
  "judge",
  "knowledge",
  "check",
]);
const EVAL_SEVERITIES = new Set<EvalMetric["severity"]>(["gate", "soft", "budget"]);

function isEvalDataset(value: unknown): value is EvalDataset {
  if (!isEvalRecord(value)) return false;
  return EVAL_DATASET_KINDS.has(value.kind as EvalDataset["kind"]) &&
    typeof value.load === "function";
}

function isEvalMetric(value: unknown): value is EvalMetric {
  if (!isEvalRecord(value)) return false;
  return typeof value.name === "string" && value.name.trim() !== "" &&
    EVAL_METRIC_FAMILIES.has(value.family as EvalMetric["family"]) &&
    EVAL_SEVERITIES.has(value.severity as EvalMetric["severity"]) &&
    typeof value.evaluate === "function";
}

function normalizeDataset(dataset: EvalDataset | EvalExampleInput[]): EvalDataset {
  return isEvalDataset(dataset) ? dataset : datasets.inline(dataset);
}

function normalizeRepetitions(repetitions: number | undefined): number {
  const value = repetitions ?? 1;
  assertFiniteEvalNumber(value, "Eval repetitions", {
    integer: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  return value;
}

function normalizeMetrics(metrics: unknown): EvalMetric[] {
  if (metrics === undefined) return [];
  if (!isEvalArray(metrics) || !metrics.every(isEvalMetric)) {
    throw createEvalValidationError("Eval metrics must be an array of valid metric definitions");
  }
  return [...metrics];
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === undefined) return {};
  if (!isEvalRecord(metadata)) {
    throw createEvalValidationError("Eval metadata must be an object");
  }
  return { ...metadata };
}

function normalizeOptionalLabel(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeEvalString(value, label);
}

function createEvalDefinition(
  targetKind: EvalTargetKind,
  input: EvalAgentInput | EvalToolInput,
): EvalDefinition {
  const target = normalizeEvalString(input.target, "Eval target");
  const id = normalizeOptionalLabel(input.id, "Eval id") ?? "";
  const name = normalizeOptionalLabel(input.name, "Eval name") ?? (id || target);
  const description = normalizeOptionalLabel(input.description, "Eval description");
  const tags = input.tags === undefined ? [] : normalizeEvalStringList(input.tags, "Eval tags");

  return {
    kind: "eval",
    targetKind,
    id,
    name,
    ...(description ? { description } : {}),
    target,
    dataset: normalizeDataset(input.dataset),
    metrics: normalizeMetrics(input.metrics),
    repetitions: normalizeRepetitions(input.repetitions),
    tags,
    metadata: normalizeMetadata(input.metadata),
    ...("input" in input && input.input ? { input: input.input } : {}),
    ...("mockTools" in input && input.mockTools ? { mockTools: input.mockTools } : {}),
    ...(input.check ? { check: input.check } : {}),
  };
}

/** Define an eval that targets a Veryfront agent. */
export function evalAgent(input: EvalAgentInput): EvalDefinition {
  return createEvalDefinition("agent", input);
}

/** Define an eval that targets a Veryfront tool. */
export function evalTool(input: EvalToolInput): EvalDefinition {
  return createEvalDefinition("tool", input);
}

/** Define a target-free eval that grades each stored dataset example directly. */
export function evalDataset(input: EvalDatasetInput): EvalDefinition {
  return createEvalDefinition("dataset", {
    ...input,
    target: normalizeEvalString(input.id, "Eval id"),
  });
}

/** Check whether a value is a normalized eval definition. */
export function isEvalDefinition(value: unknown): value is EvalDefinition {
  if (!isEvalRecord(value)) return false;
  return value.kind === "eval" &&
    (value.targetKind === "agent" || value.targetKind === "tool" ||
      value.targetKind === "dataset") &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.target === "string" &&
    value.target.trim() !== "" &&
    isEvalDataset(value.dataset) &&
    isEvalArray(value.metrics) &&
    value.metrics.every(isEvalMetric) &&
    Number.isSafeInteger(value.repetitions) &&
    (value.repetitions as number) >= 1 &&
    isEvalArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string" && tag.trim() !== "") &&
    isEvalRecord(value.metadata) &&
    (value.input === undefined || typeof value.input === "function") &&
    (value.check === undefined || typeof value.check === "function");
}
