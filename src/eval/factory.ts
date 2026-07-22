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

function isEvalDataset(value: unknown): value is EvalDataset {
  return !!value &&
    typeof value === "object" &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { load?: unknown }).load === "function";
}

function normalizeDataset(dataset: EvalDataset | EvalExampleInput[]): EvalDataset {
  return isEvalDataset(dataset) ? dataset : datasets.inline(dataset);
}

function normalizeRepetitions(repetitions: number | undefined): number {
  const value = repetitions ?? 1;
  if (!Number.isInteger(value) || value < 1) {
    throw createEvalValidationError(
      "Eval repetitions must be an integer greater than or equal to 1",
    );
  }
  return value;
}

function createEvalDefinition(
  targetKind: EvalTargetKind,
  input: EvalAgentInput | EvalToolInput,
): EvalDefinition {
  if (typeof input.target !== "string" || input.target.trim() === "") {
    throw createEvalValidationError("Eval target must be a non-empty string");
  }

  return {
    kind: "eval",
    targetKind,
    id: input.id ?? "",
    name: input.name ?? input.id ?? input.target,
    ...(input.description ? { description: input.description } : {}),
    target: input.target,
    dataset: normalizeDataset(input.dataset),
    metrics: input.metrics ?? [],
    repetitions: normalizeRepetitions(input.repetitions),
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
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

/** Check whether a value is a normalized eval definition. */
export function isEvalDefinition(value: unknown): value is EvalDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EvalDefinition>;
  return candidate.kind === "eval" &&
    (candidate.targetKind === "agent" || candidate.targetKind === "tool") &&
    typeof candidate.target === "string" &&
    isEvalDataset(candidate.dataset) &&
    Array.isArray(candidate.metrics) &&
    typeof candidate.repetitions === "number";
}
