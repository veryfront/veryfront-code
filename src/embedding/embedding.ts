import type { Embedding, EmbeddingCallOptions, EmbeddingConfig } from "./types.ts";
import { resolveEmbeddingModel } from "./resolve.ts";
import { resolveConfiguredEmbeddingModel } from "./model-resolution.ts";
import { embed, embedMany } from "#veryfront/runtime/runtime-bridge.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_PREFIX_LENGTH,
  throwIfAborted,
  validateBatchSize,
  validateBoundedString,
  validateEmbeddingCallOptions,
  validateEmbeddingTexts,
  validateEmbeddingVectors,
} from "./validation.ts";

const DEFAULT_BATCH_SIZE = 100;

function awaitWithAbort<T>(value: T | PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(value);
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };

    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Creates an embedding facade.
 *
 * Sync factory with async methods, using the same pattern as `tool()` and `agent()`.
 *
 * - `embed()` applies `queryPrefix` (optimized for search queries)
 * - `embedMany()` applies `documentPrefix` (optimized for document indexing)
 * - `embedMany()` automatically batches large inputs to stay within API limits
 *
 * @example
 * ```ts
 * const embedder = embedding({
 *   documentPrefix: "search_document: ",  // for Nomic, E5, BGE models
 *   queryPrefix: "search_query: ",
 * });
 * const vector = await embedder.embed("some query");
 * const vectors = await embedder.embedMany(["doc1", "doc2"]);
 * ```
 */
export function embedding(config: EmbeddingConfig): Embedding {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw INVALID_ARGUMENT.create({ detail: "Embedding config must be an object" });
  }
  const rawModel = config.model;
  const rawBatchSize = config.batchSize;
  const rawDocumentPrefix = config.documentPrefix;
  const rawQueryPrefix = config.queryPrefix;
  const configuredModel = rawModel === undefined
    ? undefined
    : validateBoundedString(rawModel, "embedding model", MAX_IDENTIFIER_LENGTH, {
      allowEmpty: true,
    });
  const batchSize = rawBatchSize === undefined
    ? DEFAULT_BATCH_SIZE
    : validateBatchSize(rawBatchSize);
  const docPrefix = rawDocumentPrefix === undefined
    ? ""
    : validateBoundedString(rawDocumentPrefix, "documentPrefix", MAX_PREFIX_LENGTH, {
      allowEmpty: true,
    });
  const queryPrefix = rawQueryPrefix === undefined
    ? ""
    : validateBoundedString(rawQueryPrefix, "queryPrefix", MAX_PREFIX_LENGTH, {
      allowEmpty: true,
    });
  const modelId = resolveConfiguredEmbeddingModel(configuredModel);
  const model = resolveEmbeddingModel(modelId);

  async function resolveBatchSize(signal?: AbortSignal): Promise<number> {
    throwIfAborted(signal);
    const providerLimit = await awaitWithAbort(model.maxEmbeddingsPerCall, signal);
    if (providerLimit === undefined) return batchSize;
    if (!Number.isSafeInteger(providerLimit) || providerLimit <= 0) {
      throw INVALID_ARGUMENT.create({
        detail: "Embedding runtime maxEmbeddingsPerCall must be a positive integer",
      });
    }
    return Math.min(batchSize, providerLimit);
  }

  return {
    model: modelId,

    async embed(text: string, options?: EmbeddingCallOptions): Promise<number[]> {
      const signal = validateEmbeddingCallOptions(options);
      if (typeof text === "string" && !text.trim()) {
        throw INVALID_ARGUMENT.create({ detail: "Cannot embed an empty string" });
      }
      const input = validateEmbeddingTexts([text])[0]!;
      const value = queryPrefix + input;
      validateEmbeddingTexts([value]);
      throwIfAborted(signal);
      const result = await embed({
        model,
        value,
        abortSignal: signal,
      });
      throwIfAborted(signal);
      validateEmbeddingVectors(result.embeddings, 1);
      return result.embedding;
    },

    async embedMany(
      texts: string[],
      options?: EmbeddingCallOptions,
    ): Promise<number[][]> {
      const signal = validateEmbeddingCallOptions(options);
      const inputs = validateEmbeddingTexts(texts);
      if (inputs.length === 0) return [];

      const prefixed = docPrefix ? inputs.map((text) => docPrefix + text) : inputs;
      validateEmbeddingTexts(prefixed);
      const effectiveBatchSize = await resolveBatchSize(signal);
      throwIfAborted(signal);

      // A single batch needs no additional splitting.
      if (prefixed.length <= effectiveBatchSize) {
        const result = await embedMany({
          model,
          values: prefixed,
          abortSignal: signal,
        });
        throwIfAborted(signal);
        validateEmbeddingVectors(result.embeddings, prefixed.length);
        return result.embeddings;
      }

      // Chunked batches for large inputs
      const results: number[][] = [];
      for (let i = 0; i < prefixed.length; i += effectiveBatchSize) {
        throwIfAborted(signal);
        const batch = prefixed.slice(i, i + effectiveBatchSize);
        const result = await embedMany({
          model,
          values: batch,
          abortSignal: signal,
        });
        validateEmbeddingVectors(result.embeddings, batch.length);
        results.push(...result.embeddings);
      }
      throwIfAborted(signal);
      validateEmbeddingVectors(results, prefixed.length);
      return results;
    },
  };
}
