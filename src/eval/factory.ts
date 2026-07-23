import { datasets } from "./datasets.ts";
import type {
  EvalAgentInput,
  EvalDataset,
  EvalDefinition,
  EvalExampleInput,
  EvalTargetKind,
  EvalToolInput,
} from "./types.ts";
import { createEvalValidationError } from "./validation.ts";

const MAX_EVAL_REPETITIONS = 10_000;
const MAX_EVAL_METRICS = 1_000;
const MAX_EVAL_TAGS = 1_000;
const MAX_EVAL_TEXT_LENGTH = 16_384;
const EVAL_METRIC_FAMILIES = new Set(["answer", "agent", "ops", "judge", "knowledge", "check"]);
const EVAL_SEVERITIES = new Set(["gate", "soft", "budget"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOptionalText(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > MAX_EVAL_TEXT_LENGTH) {
    throw createEvalValidationError(
      `${label} must be a string of at most ${MAX_EVAL_TEXT_LENGTH} characters`,
    );
  }
}

function isValidMetricThreshold(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const min = value.min;
  const max = value.max;
  return (min === undefined || typeof min === "number" && Number.isFinite(min)) &&
    (max === undefined || typeof max === "number" && Number.isFinite(max)) &&
    !(typeof min === "number" && typeof max === "number" && min > max);
}

function isValidMetricDefinition(metric: unknown): boolean {
  return isRecord(metric) &&
    typeof metric.name === "string" && metric.name.trim().length > 0 &&
    metric.name.length <= MAX_EVAL_TEXT_LENGTH &&
    EVAL_METRIC_FAMILIES.has(metric.family as string) &&
    EVAL_SEVERITIES.has(metric.severity as string) &&
    isValidMetricThreshold(metric.threshold) &&
    (metric.config === undefined || isRecord(metric.config)) &&
    typeof metric.evaluate === "function" &&
    typeof metric.gate === "function" &&
    typeof metric.soft === "function" &&
    typeof metric.budget === "function";
}

function normalizeMetrics(value: unknown): EvalDefinition["metrics"] {
  if (!Array.isArray(value)) {
    throw createEvalValidationError("Eval metrics must be an array");
  }
  if (value.length > MAX_EVAL_METRICS) {
    throw createEvalValidationError(`Eval metrics must not exceed ${MAX_EVAL_METRICS} entries`);
  }
  if (!value.every(isValidMetricDefinition)) {
    throw createEvalValidationError("Eval metrics must contain valid metric definitions");
  }
  return [...value] as EvalDefinition["metrics"];
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EVAL_TAGS) {
    throw createEvalValidationError(`Eval tags must be an array of at most ${MAX_EVAL_TAGS} items`);
  }
  if (
    !value.every((tag) =>
      typeof tag === "string" && tag.trim().length > 0 && tag.length <= MAX_EVAL_TEXT_LENGTH
    )
  ) {
    throw createEvalValidationError("Eval tags must contain non-empty strings");
  }
  return [...value];
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw createEvalValidationError("Eval metadata must be an object");
  }
  return { ...value };
}

function isEvalDataset(value: unknown): value is EvalDataset {
  if (!isRecord(value)) return false;
  return (value.kind === "inline" || value.kind === "json" || value.kind === "jsonl") &&
    typeof value.load === "function";
}

function normalizeDataset(dataset: EvalDataset | EvalExampleInput[]): EvalDataset {
  return isEvalDataset(dataset) ? dataset : datasets.inline(dataset);
}

function normalizeRepetitions(repetitions: number | undefined): number {
  const value = repetitions ?? 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVAL_REPETITIONS) {
    throw createEvalValidationError(
      `Eval repetitions must be an integer between 1 and ${MAX_EVAL_REPETITIONS}`,
    );
  }
  return value;
}

function createEvalDefinition(
  targetKind: EvalTargetKind,
  input: EvalAgentInput | EvalToolInput,
): EvalDefinition {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw createEvalValidationError("Eval definition input must be an object");
  }
  if (typeof input.target !== "string" || input.target.trim() === "") {
    throw createEvalValidationError("Eval target must be a non-empty string");
  }
  if (input.target.length > MAX_EVAL_TEXT_LENGTH) {
    throw createEvalValidationError(
      `Eval target must not exceed ${MAX_EVAL_TEXT_LENGTH} characters`,
    );
  }
  assertOptionalText(input.id, "Eval id");
  assertOptionalText(input.name, "Eval name");
  assertOptionalText(input.description, "Eval description");
  if (input.check !== undefined && typeof input.check !== "function") {
    throw createEvalValidationError("Eval check must be a function when provided");
  }
  if ("input" in input && input.input !== undefined && typeof input.input !== "function") {
    throw createEvalValidationError("Eval tool input mapper must be a function when provided");
  }

  const metrics = normalizeMetrics(input.metrics ?? []);
  const tags = normalizeTags(input.tags ?? []);
  const metadata = normalizeMetadata(input.metadata ?? {});

  return {
    kind: "eval",
    targetKind,
    id: input.id ?? "",
    name: input.name ?? input.id ?? input.target,
    ...(input.description ? { description: input.description } : {}),
    target: input.target,
    dataset: normalizeDataset(input.dataset),
    metrics,
    repetitions: normalizeRepetitions(input.repetitions),
    tags,
    metadata,
    ...("input" in input && input.input ? { input: input.input } : {}),
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

/** Check whether a value is a normalized eval definition. */
export function isEvalDefinition(value: unknown): value is EvalDefinition {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<EvalDefinition>;
  return candidate.kind === "eval" &&
    (candidate.targetKind === "agent" || candidate.targetKind === "tool") &&
    typeof candidate.id === "string" &&
    candidate.id.length <= MAX_EVAL_TEXT_LENGTH &&
    typeof candidate.name === "string" && candidate.name.length <= MAX_EVAL_TEXT_LENGTH &&
    typeof candidate.target === "string" && candidate.target.trim().length > 0 &&
    candidate.target.length <= MAX_EVAL_TEXT_LENGTH &&
    (candidate.description === undefined ||
      (typeof candidate.description === "string" &&
        candidate.description.length <= MAX_EVAL_TEXT_LENGTH)) &&
    isEvalDataset(candidate.dataset) &&
    Array.isArray(candidate.metrics) && candidate.metrics.length <= MAX_EVAL_METRICS &&
    candidate.metrics.every(isValidMetricDefinition) &&
    Number.isSafeInteger(candidate.repetitions) && candidate.repetitions! >= 1 &&
    candidate.repetitions! <= MAX_EVAL_REPETITIONS &&
    Array.isArray(candidate.tags) && candidate.tags.length <= MAX_EVAL_TAGS &&
    candidate.tags.every((tag) =>
      typeof tag === "string" && tag.trim().length > 0 && tag.length <= MAX_EVAL_TEXT_LENGTH
    ) &&
    isRecord(candidate.metadata) &&
    (candidate.input === undefined || typeof candidate.input === "function") &&
    (candidate.check === undefined || typeof candidate.check === "function");
}
