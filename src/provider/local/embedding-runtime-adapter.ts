/**
 * Local Embedding Runtime Adapter
 *
 * Bridges `@huggingface/transformers` local embedding inference to the
 * framework's current embedding runtime interface. This allows `embed()` and
 * `embedMany()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import { embedTexts } from "./local-embedding-engine.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from "./model-catalog.ts";
import type { EmbeddingRuntime } from "../types.ts";

/**
 * Create a local embedding runtime for the given model ID.
 *
 * The returned object implements the current embedding runtime interface, making it
 * compatible with all framework embedding functions and the Veryfront
 * embedding/RAG primitives.
 */
export function createLocalEmbeddingModel(modelId?: string): EmbeddingRuntime {
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
  };
}
