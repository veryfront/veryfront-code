import { embed, embedMany } from "ai";
import type { Embedding, EmbeddingConfig } from "./types.ts";
import { resolveEmbeddingModel } from "./resolve.ts";
import { resolveConfiguredEmbeddingModel } from "./model-resolution.ts";

const DEFAULT_BATCH_SIZE = 100;

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
  const modelId = resolveConfiguredEmbeddingModel(config.model);
  const model = resolveEmbeddingModel(modelId);
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const docPrefix = config.documentPrefix ?? "";
  const queryPrefix = config.queryPrefix ?? "";

  return {
    model: modelId,

    async embed(text: string): Promise<number[]> {
      const value = queryPrefix + text;
      if (!value.trim()) {
        throw new Error("Cannot embed an empty string");
      }
      const result = await embed({ model, value });
      return result.embedding;
    },

    async embedMany(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const prefixed = docPrefix ? texts.map((t) => docPrefix + t) : texts;

      // Single batch — no chunking needed
      if (prefixed.length <= batchSize) {
        const result = await embedMany({ model, values: prefixed });
        return result.embeddings;
      }

      // Chunked batches for large inputs
      const results: number[][] = [];
      for (let i = 0; i < prefixed.length; i += batchSize) {
        const batch = prefixed.slice(i, i + batchSize);
        const result = await embedMany({ model, values: batch });
        results.push(...result.embeddings);
      }
      return results;
    },
  };
}
