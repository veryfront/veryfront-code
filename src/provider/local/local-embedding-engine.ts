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
import { createPipelineCache } from "./pipeline-cache.ts";

const logger = serverLogger.component("local-embedding");

interface EmbeddingOutput {
  tolist(): number[][];
}

interface Pipeline {
  (texts: string[], options: { pooling: string; normalize: boolean }): Promise<EmbeddingOutput>;
}

/**
 * Bounded, dedup-aware cache of feature-extraction pipelines keyed by
 * HuggingFace model id. Only loads a model on a cold cache miss; concurrent
 * loads of the same model share a single promise.
 */
const embeddingPipelines = createPipelineCache<Pipeline, ModelInfo>(async (modelInfo) => {
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
  return pipe;
});

/**
 * Load a feature-extraction pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
function loadPipeline(modelInfo: ModelInfo): Promise<Pipeline> {
  return embeddingPipelines.load(modelInfo.hfId, modelInfo);
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
