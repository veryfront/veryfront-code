import { INVALID_ARGUMENT } from "#veryfront/errors";
import type {
  ChunkOptions,
  EmbeddingCallOptions,
  RagRefreshOptions,
  RagSearchOptions,
  RagStoreConfig,
  SearchOptions,
} from "./types.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CONFIGURED_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_RAG_TEXT_LENGTH = 5 * 1024 * 1024;
export const MAX_EMBEDDING_INPUT_LENGTH = 1024 * 1024;
export const MAX_EMBEDDING_TOTAL_LENGTH = 16 * 1024 * 1024;
export const MAX_EMBEDDING_INPUTS = 10_000;
export const MAX_EMBEDDING_DIMENSION = 16_384;
export const MAX_VECTOR_SEARCH_RESULTS = 1_000;
export const MAX_RAG_SEARCH_RESULTS = 100;
export const MAX_IDENTIFIER_LENGTH = 512;
export const MAX_TITLE_LENGTH = 4_096;
export const MAX_SOURCE_LENGTH = 8_192;
export const MAX_TYPE_LENGTH = 128;
export const MAX_PATH_LENGTH = 4_096;
export const MAX_PREFIX_LENGTH = 4_096;
export const MAX_CONTENT_EXTENSIONS = 64;

const MAX_SEPARATORS = 16;
const MAX_SEPARATOR_LENGTH = 1_024;
const MAX_BATCH_SIZE = 10_000;

function invalid(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

export function assertOptionsObject(
  value: unknown,
  name: string,
): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${name} must be an object`);
  }
}

export function validateEmbeddingCallOptions(
  options?: EmbeddingCallOptions,
): AbortSignal | undefined {
  if (options === undefined) return undefined;
  assertOptionsObject(options, "Embedding call options");
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    invalid("Embedding call signal must be an AbortSignal");
  }
  return signal;
}

export function assertPositiveInteger(
  value: unknown,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    invalid(`${name} must be a positive integer`);
  }
  if (Number(value) > maximum) {
    invalid(`${name} must not exceed ${maximum}`);
  }
}

export function validateBatchSize(value: unknown): number {
  assertPositiveInteger(value, "batchSize", MAX_BATCH_SIZE);
  return value;
}

export function validateChunkOptions(options?: ChunkOptions): Required<ChunkOptions> {
  if (options !== undefined) assertOptionsObject(options, "Chunk options");
  const maxChars = options?.maxChars ?? 2_000;
  const overlap = options?.overlap ?? Math.min(200, maxChars - 1);
  const rawSeparators = options?.separators ?? ["\n\n", "\n", " ", ""];

  assertPositiveInteger(maxChars, "maxChars", MAX_EMBEDDING_INPUT_LENGTH);
  if (!Number.isSafeInteger(overlap) || Number(overlap) < 0) {
    invalid("overlap must be a non-negative integer");
  }
  if (overlap >= maxChars) {
    invalid("overlap must be smaller than maxChars");
  }
  if (!Array.isArray(rawSeparators)) {
    invalid("separators must be an array of strings");
  }
  if (rawSeparators.length > MAX_SEPARATORS) {
    invalid(`separators supports at most ${MAX_SEPARATORS} entries`);
  }

  const separators = rawSeparators.map((separator) => {
    if (typeof separator !== "string") {
      invalid("separators must contain only strings");
    }
    if (separator.length > MAX_SEPARATOR_LENGTH) {
      invalid(`separator length must not exceed ${MAX_SEPARATOR_LENGTH} characters`);
    }
    return separator;
  });
  if (new Set(separators).size !== separators.length) {
    invalid("separators must not contain duplicates");
  }

  return { maxChars, overlap, separators };
}

export function validateEmbeddingTexts(values: unknown): string[] {
  if (!Array.isArray(values)) {
    invalid("Embedding inputs must be an array of strings");
  }
  if (values.length > MAX_EMBEDDING_INPUTS) {
    invalid(`Embedding inputs support at most ${MAX_EMBEDDING_INPUTS} values`);
  }

  let totalLength = 0;
  return values.map((value, index) => {
    if (typeof value !== "string") {
      invalid(`Embedding input ${index} must be a string`);
    }
    if (!value.trim()) {
      invalid(`Embedding input ${index} must not be empty`);
    }
    if (value.length > MAX_EMBEDDING_INPUT_LENGTH) {
      invalid(`Embedding input ${index} exceeds the supported size`);
    }
    totalLength += value.length;
    if (totalLength > MAX_EMBEDDING_TOTAL_LENGTH) {
      invalid("Embedding inputs exceed the supported total size");
    }
    return value;
  });
}

export function validateEmbeddingVectors(
  vectors: unknown,
  expectedCount: number,
): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    const received = Array.isArray(vectors) ? vectors.length : 0;
    invalid(
      `Embedding response count must match input count: expected ${expectedCount}, received ${received}`,
    );
  }

  let dimension: number | undefined;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) {
      invalid("Embedding vectors must not be empty");
    }
    if (vector.length > MAX_EMBEDDING_DIMENSION) {
      invalid(`Embedding vector dimension must not exceed ${MAX_EMBEDDING_DIMENSION}`);
    }
    if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
      invalid("Embedding vectors must contain only finite numbers");
    }
    if (!hasFiniteSquaredNorm(vector)) {
      invalid("Embedding vectors must have a finite squared norm");
    }
    if (dimension === undefined) {
      dimension = vector.length;
    } else if (dimension !== vector.length) {
      invalid("Embedding vectors must use one consistent dimension");
    }
  }
}

export function hasFiniteSquaredNorm(vector: number[]): boolean {
  let squaredNorm = 0;
  for (const value of vector) {
    squaredNorm += value * value;
    if (!Number.isFinite(squaredNorm)) return false;
  }
  return true;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The embedding operation was aborted", "AbortError");
  }
}

function validateOptionalFiniteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${name} must be a finite number`);
  }
  return value;
}

export function validateVectorSearchOptions(options?: SearchOptions):
  & Required<
    Pick<SearchOptions, "topK" | "strategy" | "lambda">
  >
  & Pick<SearchOptions, "threshold" | "filter" | "signal"> {
  if (options !== undefined) assertOptionsObject(options, "Vector search options");
  const topK = options?.topK ?? 5;
  assertPositiveInteger(topK, "topK", MAX_VECTOR_SEARCH_RESULTS);
  const threshold = validateOptionalFiniteNumber(options?.threshold, "threshold");
  if (threshold !== undefined && (threshold < -1 || threshold > 1)) {
    invalid("threshold must be between -1 and 1");
  }
  const strategy = options?.strategy ?? "dense";
  if (strategy !== "dense" && strategy !== "hybrid" && strategy !== "mmr") {
    invalid('strategy must be "dense", "hybrid", or "mmr"');
  }
  const lambda = validateOptionalFiniteNumber(options?.lambda, "lambda") ?? 0.5;
  if (lambda < 0 || lambda > 1) {
    invalid("lambda must be between 0 and 1");
  }
  const filter = options?.filter;
  if (
    filter !== undefined && (typeof filter !== "object" || filter === null || Array.isArray(filter))
  ) {
    invalid("filter must be an object");
  }
  const signal = options?.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    invalid("Vector search signal must be an AbortSignal");
  }

  return {
    topK,
    threshold,
    filter: filter ? { ...filter } : undefined,
    strategy,
    lambda,
    signal,
  };
}

export function validateRagSearchOptions(options?: RagSearchOptions): {
  topK: number;
  threshold: number;
  signal?: AbortSignal;
} {
  if (options !== undefined) assertOptionsObject(options, "RAG search options");
  const topK = options?.topK ?? 5;
  assertPositiveInteger(topK, "topK", MAX_RAG_SEARCH_RESULTS);
  const threshold = validateOptionalFiniteNumber(options?.threshold, "threshold") ?? 0;
  if (threshold < -1 || threshold > 1) {
    invalid("threshold must be between -1 and 1");
  }
  const signal = options?.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    invalid("RAG search signal must be an AbortSignal");
  }
  return { topK, threshold, signal };
}

export function validateBoundedString(
  value: unknown,
  name: string,
  maximum: number,
  options: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") {
    invalid(`${name} must be a string`);
  }
  if (!options.allowEmpty && !value.trim()) {
    invalid(`${name} must not be empty`);
  }
  if (value.length > maximum) {
    invalid(`${name} exceeds ${maximum} characters`);
  }
  return value;
}

export function validateRagText(text: unknown): string {
  return validateBoundedString(text, "RAG document text", MAX_RAG_TEXT_LENGTH);
}

export function validateRagDocumentId(id: unknown): string {
  return validateBoundedString(id, "RAG document ID", MAX_IDENTIFIER_LENGTH);
}

export function validateRagTitle(title: unknown): string {
  return validateBoundedString(title, "RAG document title", MAX_TITLE_LENGTH);
}

function snapshotOptionalString(
  value: unknown,
  name: string,
  maximum: number,
  allowEmpty = true,
): string | undefined {
  return value === undefined
    ? undefined
    : validateBoundedString(value, name, maximum, { allowEmpty });
}

export function snapshotRefreshOptions(
  meta: RagRefreshOptions | undefined,
): RagRefreshOptions | undefined {
  if (meta === undefined) return undefined;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    invalid("RAG refresh metadata must be an object");
  }
  const title = meta.title;
  const source = meta.source;
  const type = meta.type;
  return {
    title: snapshotOptionalString(title, "RAG document title", MAX_TITLE_LENGTH, false),
    source: snapshotOptionalString(source, "RAG document source", MAX_SOURCE_LENGTH),
    type: snapshotOptionalString(type, "RAG document type", MAX_TYPE_LENGTH),
  };
}

export function snapshotRagStoreConfig(config: RagStoreConfig): RagStoreConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    invalid("RAG store config must be an object");
  }

  const model = config.model;
  const backend = config.backend;
  const branch = config.branch;
  const storagePath = config.storagePath;
  const contentDir = config.contentDir;
  const rawContentExtensions = config.contentExtensions;
  const rawChunkOptions = config.chunkOptions;
  const documentPrefix = config.documentPrefix;
  const queryPrefix = config.queryPrefix;
  const rawBatchSize = config.batchSize;

  if (backend !== undefined && typeof backend !== "string") {
    invalid("RAG store backend must be a string");
  }
  if (backend !== undefined) {
    validateBoundedString(backend, "RAG store backend", 32);
  }
  const contentExtensions = rawContentExtensions === undefined ? undefined : (() => {
    if (!Array.isArray(rawContentExtensions)) {
      invalid("contentExtensions must be an array of strings");
    }
    if (rawContentExtensions.length > MAX_CONTENT_EXTENSIONS) {
      invalid(`contentExtensions supports at most ${MAX_CONTENT_EXTENSIONS} entries`);
    }
    const normalized = rawContentExtensions.map((extension) => {
      const value = validateBoundedString(
        extension,
        "content extension",
        MAX_TYPE_LENGTH,
      ).toLowerCase();
      if (
        value !== value.trim() || value.length < 2 || !value.startsWith(".") ||
        value.slice(1).includes(".") || /[/\\\p{C}]/u.test(value)
      ) {
        invalid("content extensions must be single file extensions");
      }
      return value;
    });
    if (new Set(normalized).size !== normalized.length) {
      invalid("contentExtensions must not contain duplicates");
    }
    return normalized;
  })();

  const stableContentExtensions = contentExtensions ? [...contentExtensions] : undefined;
  if (stableContentExtensions) Object.freeze(stableContentExtensions);
  const stableChunkOptions = rawChunkOptions === undefined
    ? undefined
    : validateChunkOptions(rawChunkOptions);
  if (stableChunkOptions) {
    Object.freeze(stableChunkOptions.separators);
    Object.freeze(stableChunkOptions);
  }

  return Object.freeze({
    model: snapshotOptionalString(model, "embedding model", MAX_IDENTIFIER_LENGTH),
    backend,
    branch: snapshotOptionalString(branch, "RAG branch", MAX_IDENTIFIER_LENGTH, false),
    storagePath: snapshotOptionalString(
      storagePath,
      "RAG storage path",
      MAX_PATH_LENGTH,
      false,
    ),
    contentDir: snapshotOptionalString(
      contentDir,
      "RAG content directory",
      MAX_PATH_LENGTH,
      false,
    ),
    contentExtensions: stableContentExtensions,
    chunkOptions: stableChunkOptions,
    documentPrefix: snapshotOptionalString(
      documentPrefix,
      "documentPrefix",
      MAX_PREFIX_LENGTH,
    ),
    queryPrefix: snapshotOptionalString(queryPrefix, "queryPrefix", MAX_PREFIX_LENGTH),
    batchSize: rawBatchSize === undefined ? undefined : validateBatchSize(rawBatchSize),
  });
}

export function snapshotIngestMetadata(
  meta: { source?: string; type?: string } | undefined,
): { source?: string; type?: string } | undefined {
  if (meta === undefined) return undefined;
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    invalid("RAG document metadata must be an object");
  }
  const source = meta.source;
  const type = meta.type;
  return {
    source: snapshotOptionalString(source, "RAG document source", MAX_SOURCE_LENGTH),
    type: snapshotOptionalString(type, "RAG document type", MAX_TYPE_LENGTH),
  };
}
