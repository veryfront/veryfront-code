import { isAbsolute, join } from "#veryfront/compat/path";
import type { EvalDataset, EvalDatasetLoadContext, EvalExampleInput } from "./types.ts";
import {
  createEvalValidationError,
  normalizeEvalExamples,
  normalizeEvalString,
} from "./validation.ts";

function resolveDatasetPath(baseDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

/**
 * A project file reader serves files relative to the project root only. Absolute paths would
 * otherwise fall back to this host's disk, and `..` segments would escape the project, so both
 * are rejected instead of being read from anywhere.
 */
function assertProjectRelativeDatasetPath(filePath: string): void {
  if (isAbsolute(filePath) || /^[\\/]/.test(filePath) || /^[A-Za-z]:/.test(filePath)) {
    // Do not echo the path: an absolute path can expose host directory layout in run failures.
    throw createEvalValidationError(
      "Dataset path must be relative to the project when read through the project files",
    );
  }
  if (filePath.split(/[\\/]/).includes("..")) {
    throw createEvalValidationError(
      "Dataset path must not contain '..' segments when read through the project files",
    );
  }
}

function readDatasetText(context: EvalDatasetLoadContext, filePath: string): Promise<string> {
  if (context.readTextFile) {
    assertProjectRelativeDatasetPath(filePath);
    return context.readTextFile(filePath);
  }
  return Deno.readTextFile(resolveDatasetPath(context.baseDir, filePath));
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
      async load(context) {
        const text = await readDatasetText(context, datasetPath);
        return normalizeEvalExamples(parseJsonDataset(text, datasetPath), datasetPath);
      },
    };
  },

  jsonl(path: string): EvalDataset {
    const datasetPath = normalizeEvalString(path, "JSONL dataset path");
    return {
      kind: "jsonl",
      path: datasetPath,
      async load(context) {
        const text = await readDatasetText(context, datasetPath);
        return normalizeEvalExamples(parseJsonlDataset(text, datasetPath), datasetPath);
      },
    };
  },
} as const;
