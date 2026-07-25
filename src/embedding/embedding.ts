import type { Embedding, EmbeddingCallOptions, EmbeddingConfig } from "./types.ts";
import { resolveEmbeddingModel } from "./resolve.ts";
import { resolveConfiguredEmbeddingModel } from "./model-resolution.ts";
import { embed, embedMany } from "#veryfront/runtime/runtime-bridge.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  requirePositiveSafeInteger,
  validateEmbeddingBatch,
  validateEmbeddingVector,
} from "./validation.ts";
import { BoundedSerialExecutor, waitWithAbort } from "./admission.ts";

const DEFAULT_BATCH_SIZE = 100;
const MAX_CONFIGURED_BATCH_SIZE = 10_000;
const MAX_SERIAL_PROVIDER_WAITERS = 256;

/**
 * Creates an embedding facade.
 *
 * Sync factory, async methods — same pattern as `tool()` and `agent()`.
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
  const batchSize = requirePositiveSafeInteger(
    config.batchSize ?? DEFAULT_BATCH_SIZE,
    "embedding batchSize",
    MAX_CONFIGURED_BATCH_SIZE,
  );
  const modelId = resolveConfiguredEmbeddingModel(config.model);
  const model = resolveEmbeddingModel(modelId);
  const docPrefix = config.documentPrefix ?? "";
  const queryPrefix = config.queryPrefix ?? "";
  const serialExecutor = new BoundedSerialExecutor(
    `embedding runtime ${modelId}`,
    MAX_SERIAL_PROVIDER_WAITERS,
  );
  const parallelCapability = Promise.resolve(model.supportsParallelCalls);

  async function runModelOperation<T>(
    operation: () => PromiseLike<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const supportsParallelCalls = await waitWithAbort(
      parallelCapability,
      signal,
    );
    signal?.throwIfAborted();
    return supportsParallelCalls === false ? serialExecutor.run(operation, signal) : operation();
  }

  async function effectiveBatchSize(): Promise<number> {
    const providerLimit = await model.maxEmbeddingsPerCall;
    if (providerLimit === undefined) return batchSize;
    return Math.min(
      batchSize,
      requirePositiveSafeInteger(
        providerLimit,
        "embedding provider maxEmbeddingsPerCall",
      ),
    );
  }

  return {
    model: modelId,

    async embed(text: string, options?: EmbeddingCallOptions): Promise<number[]> {
      options?.abortSignal?.throwIfAborted();
      if (typeof text !== "string" || !text.trim()) {
        throw INVALID_ARGUMENT.create({ detail: "Cannot embed an empty string" });
      }
      const value = queryPrefix + text;
      const result = await runModelOperation(
        () =>
          embed({
            model,
            value,
            abortSignal: options?.abortSignal,
          }),
        options?.abortSignal,
      );
      return validateEmbeddingVector(result.embedding, "embedding result");
    },

    async embedMany(
      texts: string[],
      options?: EmbeddingCallOptions,
    ): Promise<number[][]> {
      if (!Array.isArray(texts)) {
        throw INVALID_ARGUMENT.create({ detail: "Embedding inputs must be an array" });
      }
      if (texts.length === 0) return [];
      options?.abortSignal?.throwIfAborted();

      const input = [...texts];
      for (let index = 0; index < input.length; index++) {
        if (typeof input[index] !== "string" || !input[index]!.trim()) {
          throw INVALID_ARGUMENT.create({
            detail: `Cannot embed an empty string at index ${index}`,
          });
        }
      }

      const prefixed = docPrefix ? input.map((text) => docPrefix + text) : input;
      const resolvedBatchSize = await effectiveBatchSize();

      // Single batch — no chunking needed
      if (prefixed.length <= resolvedBatchSize) {
        options?.abortSignal?.throwIfAborted();
        const result = await runModelOperation(
          () =>
            embedMany({
              model,
              values: prefixed,
              abortSignal: options?.abortSignal,
            }),
          options?.abortSignal,
        );
        return validateEmbeddingBatch(
          result.embeddings,
          prefixed.length,
          "embedding result",
        ).vectors;
      }

      // Chunked batches for large inputs
      const results: number[][] = [];
      let dimension: number | undefined;
      for (let i = 0; i < prefixed.length; i += resolvedBatchSize) {
        options?.abortSignal?.throwIfAborted();
        const batch = prefixed.slice(i, i + resolvedBatchSize);
        const result = await runModelOperation(
          () =>
            embedMany({
              model,
              values: batch,
              abortSignal: options?.abortSignal,
            }),
          options?.abortSignal,
        );
        const validated = validateEmbeddingBatch(
          result.embeddings,
          batch.length,
          "embedding result",
          dimension,
        );
        dimension = validated.dimension;
        results.push(...validated.vectors);
      }
      return results;
    },
  };
}
