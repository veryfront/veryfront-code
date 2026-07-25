import { isAbsolute, join } from "@std/path";
import type { EvalDataset, EvalExampleInput } from "./types.ts";
import {
  createEvalValidationError,
  normalizeEvalExamples,
  normalizeEvalString,
} from "./validation.ts";

function resolveDatasetPath(baseDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

function parseJsonDataset(text: string, source: string): EvalExampleInput[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as EvalExampleInput[];
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { examples?: unknown }).examples)
  ) {
    return (parsed as { examples: EvalExampleInput[] }).examples;
  }
  throw createEvalValidationError(`${source} must contain an array or an object with examples`);
}

function parseJsonlDataset(text: string, source: string): EvalExampleInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvalExampleInput;
      } catch (error) {
        throw createEvalValidationError(
          `${source}:${index + 1} must be valid JSON (${
            error instanceof Error ? error.message : error
          })`,
        );
      }
    });
}

/** Dataset factories for inline, JSON, and JSONL eval examples. */
export const datasets = {
  inline(examples: readonly EvalExampleInput[]): EvalDataset {
    const normalized = normalizeEvalExamples(examples, "inline dataset");
    return {
      kind: "inline",
      examples: normalized,
      async load() {
        return normalized.map((example) => ({ ...example }));
      },
    };
  },

  json(path: string): EvalDataset {
    const datasetPath = normalizeEvalString(path, "JSON dataset path");
    return {
      kind: "json",
      path: datasetPath,
      async load({ baseDir }) {
        const resolvedPath = resolveDatasetPath(baseDir, datasetPath);
        const text = await Deno.readTextFile(resolvedPath);
        return normalizeEvalExamples(parseJsonDataset(text, datasetPath), datasetPath);
      },
    };
  },

  jsonl(path: string): EvalDataset {
    const datasetPath = normalizeEvalString(path, "JSONL dataset path");
    return {
      kind: "jsonl",
      path: datasetPath,
      async load({ baseDir }) {
        const resolvedPath = resolveDatasetPath(baseDir, datasetPath);
        const text = await Deno.readTextFile(resolvedPath);
        return normalizeEvalExamples(parseJsonlDataset(text, datasetPath), datasetPath);
      },
    };
  },
} as const;
