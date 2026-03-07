/**
 * Local Embedding Engine
 *
 * Singleton wrapper around `@huggingface/transformers` for server-side
 * local embedding generation. Uses the `feature-extraction` pipeline
 * with mean pooling and normalization.
 *
 * @module provider/local
 */

import { serverLogger } from "#veryfront/utils";
import { type ModelInfo, resolveLocalEmbeddingModel } from "./model-catalog.ts";
import { getTransformers } from "./local-engine.ts";

const logger = serverLogger.component("local-embedding");

interface EmbeddingOutput {
  tolist(): number[][];
}

interface Pipeline {
  (texts: string[], options: { pooling: string; normalize: boolean }): Promise<EmbeddingOutput>;
}

/** Cached pipeline instances keyed by HuggingFace model ID */
const pipelineCache = new Map<string, Pipeline>();

/** Whether a model is currently being loaded (prevents concurrent loads) */
const loadingLocks = new Map<string, Promise<Pipeline>>();

/**
 * Load a feature-extraction pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
async function loadPipeline(modelInfo: ModelInfo): Promise<Pipeline> {
  const cacheKey = modelInfo.hfId;

  const cached = pipelineCache.get(cacheKey);
  if (cached) return cached;

  const existingLock = loadingLocks.get(cacheKey);
  if (existingLock) return existingLock;

  const loadPromise = (async () => {
    const transformers = await getTransformers();

    logger.info(
      `Loading local embedding model: ${modelInfo.hfId} (${modelInfo.dtype}, ~${modelInfo.sizeMB}MB)...`,
    );

    const pipe = (await transformers.pipeline(
      "feature-extraction",
      modelInfo.hfId,
      {
        dtype: modelInfo.dtype,
        device: "cpu",
      },
    )) as Pipeline;

    logger.info(`Embedding model loaded: ${modelInfo.hfId}`);
    pipelineCache.set(cacheKey, pipe);
    loadingLocks.delete(cacheKey);
    return pipe;
  })();

  loadingLocks.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } catch (error) {
    loadingLocks.delete(cacheKey);
    throw error;
  }
}

/**
 * Generate embeddings for an array of texts using a local model.
 *
 * Uses mean pooling and L2 normalization to produce unit vectors,
 * matching the behavior of cloud embedding APIs.
 */
export async function embedTexts(
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  const modelInfo = resolveLocalEmbeddingModel(modelId);
  const pipe = await loadPipeline(modelInfo);

  const pooling = modelInfo.pooling ?? "mean";
  const output = await pipe(texts, { pooling, normalize: true });

  return output.tolist();
}
