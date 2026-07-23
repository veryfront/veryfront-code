/**
 * Local Embedding Runtime Adapter
 *
 * Bridges `@huggingface/transformers` local embedding inference to the
 * framework's current embedding runtime interface. This allows `embed()` and
 * `embedMany()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import { embedTexts, MAX_LOCAL_EMBEDDINGS_PER_CALL } from "./local-embedding-engine.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL, resolveLocalEmbeddingModel } from "./model-catalog.ts";
import type { EmbeddingRuntime } from "../types.ts";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Local embedding request was aborted", "AbortError");
  }
}

/**
 * Create a local embedding runtime for the given model ID.
 *
 * The returned object implements the current embedding runtime interface, making it
 * compatible with all framework embedding functions and the Veryfront
 * embedding/RAG primitives.
 */
export function createLocalEmbeddingModel(modelId?: string): EmbeddingRuntime {
  const resolvedId = modelId === undefined ? DEFAULT_LOCAL_EMBEDDING_MODEL : modelId;
  resolveLocalEmbeddingModel(resolvedId);

  return {
    specificationVersion: "v2",
    provider: "local",
    modelId: `local/${resolvedId}`,
    maxEmbeddingsPerCall: MAX_LOCAL_EMBEDDINGS_PER_CALL,
    supportsParallelCalls: false,

    async doEmbed({ values, abortSignal }: { values: string[]; abortSignal?: AbortSignal }) {
      throwIfAborted(abortSignal);
      if (Array.isArray(values) && values.length === 0) {
        return { embeddings: [], usage: { tokens: 0 }, warnings: [] };
      }
      const embeddings = await embedTexts(resolvedId, values);
      throwIfAborted(abortSignal);
      return { embeddings, usage: { tokens: 0 }, rawResponse: undefined, warnings: [] };
    },
  };
}
