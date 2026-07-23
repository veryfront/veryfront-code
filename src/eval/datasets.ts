import { isAbsolute, join } from "@std/path";
import type { EvalDataset, EvalExampleInput } from "./types.ts";
import { createEvalValidationError, normalizeEvalExamples } from "./validation.ts";

const MAX_EVAL_DATASET_BYTES = 32 * 1024 * 1024;
const MAX_EVAL_DATASET_PATH_LENGTH = 4_096;

function assertDatasetPath(path: string): void {
  if (
    typeof path !== "string" || path.trim().length === 0 ||
    path.length > MAX_EVAL_DATASET_PATH_LENGTH || path.includes("\0")
  ) {
    throw createEvalValidationError(
      `Eval dataset path must be a non-empty string of at most ${MAX_EVAL_DATASET_PATH_LENGTH} characters`,
    );
  }
}

async function readDatasetText(path: string, source: string): Promise<string> {
  const file = await Deno.open(path, { read: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    const buffer = new Uint8Array(64 * 1024);
    while (true) {
      const bytesRead = await file.read(buffer);
      if (bytesRead === null) break;
      totalBytes += bytesRead;
      if (totalBytes > MAX_EVAL_DATASET_BYTES) {
        throw createEvalValidationError(
          `${source} exceeds the ${MAX_EVAL_DATASET_BYTES}-byte eval dataset limit`,
        );
      }
      chunks.push(buffer.slice(0, bytesRead));
    }
  } finally {
    file.close();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw createEvalValidationError(`${source} must contain valid UTF-8 text`);
  }
}

function resolveDatasetPath(baseDir: string, filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(baseDir, filePath);
}

function parseJsonDataset(text: string, source: string): EvalExampleInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createEvalValidationError(
      `${source} must be valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
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
    assertDatasetPath(path);
    return {
      kind: "json",
      path,
      async load({ baseDir }) {
        const resolvedPath = resolveDatasetPath(baseDir, path);
        const text = await readDatasetText(resolvedPath, path);
        return normalizeEvalExamples(parseJsonDataset(text, path), path);
      },
    };
  },

  jsonl(path: string): EvalDataset {
    assertDatasetPath(path);
    return {
      kind: "jsonl",
      path,
      async load({ baseDir }) {
        const resolvedPath = resolveDatasetPath(baseDir, path);
        const text = await readDatasetText(resolvedPath, path);
        return normalizeEvalExamples(parseJsonlDataset(text, path), path);
      },
    };
  },
} as const;
