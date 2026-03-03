/**
 * AI SDK Adapter for Local Embedding Models
 *
 * Bridges `@huggingface/transformers` local embedding inference to the
 * AI SDK `EmbeddingModel` interface. This allows `embed()` and
 * `embedMany()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import type { EmbeddingModel } from "ai";
import { embedTexts } from "./local-embedding-engine.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from "./model-catalog.ts";

/**
 * Create a local AI SDK EmbeddingModel for the given model ID.
 *
 * The returned object implements the EmbeddingModelV2 interface, making it
 * compatible with all AI SDK embedding functions and the VeryFront
 * embedding/RAG primitives.
 */
export function createLocalEmbeddingModel(modelId?: string): EmbeddingModel {
  const resolvedId = modelId || DEFAULT_LOCAL_EMBEDDING_MODEL;

  return {
    specificationVersion: "v2",
    provider: "local",
    modelId: `local/${resolvedId}`,
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: false,

    async doEmbed({ values }: { values: string[] }) {
      const embeddings = await embedTexts(resolvedId, values);
      return { embeddings, usage: { tokens: 0 }, rawResponse: undefined, warnings: [] };
    },
  } as EmbeddingModel;
}
