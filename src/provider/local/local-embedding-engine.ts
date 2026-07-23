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
import { createPipelineCache, type PipelineLease } from "./pipeline-cache.ts";
import { createError, fromError, toError } from "#veryfront/errors";

const logger = serverLogger.component("local-embedding");
/** Maximum number of values accepted by one local embedding inference call. */
export const MAX_LOCAL_EMBEDDINGS_PER_CALL = 128;

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
  try {
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
  } catch (error) {
    if (fromError(error)) throw error;
    throw toError(createError({
      type: "no_ai_available",
      message: "Local embedding model could not be loaded. Check network access and retry.",
    }));
  }
});

/**
 * Load a feature-extraction pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
function acquirePipeline(modelInfo: ModelInfo): Promise<PipelineLease<Pipeline>> {
  return embeddingPipelines.acquire(modelInfo.hfId, modelInfo);
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
  if (!Array.isArray(texts) || texts.length > MAX_LOCAL_EMBEDDINGS_PER_CALL) {
    throw new RangeError(
      `Local embedding requests support at most ${MAX_LOCAL_EMBEDDINGS_PER_CALL} values`,
    );
  }
  let totalCharacters = 0;
  for (const text of texts) {
    if (typeof text !== "string" || text.length > 1_024 * 1_024) {
      throw new RangeError("Local embedding input exceeded the supported size");
    }
    totalCharacters += text.length;
    if (totalCharacters > 4 * 1_024 * 1_024) {
      throw new RangeError("Local embedding request exceeded the supported size");
    }
  }
  if (texts.length === 0) return [];
  const lease = await acquirePipeline(modelInfo);

  const pooling = modelInfo.pooling ?? "mean";
  let output: EmbeddingOutput;
  try {
    output = await lease.value(texts, { pooling, normalize: true });
  } catch (error) {
    if (fromError(error)) throw error;
    throw toError(createError({ type: "agent", message: "Local embedding generation failed." }));
  } finally {
    lease.release();
  }

  let embeddings: number[][];
  try {
    embeddings = output.tolist();
  } catch {
    throw toError(createError({ type: "agent", message: "Local embedding generation failed." }));
  }
  if (
    !Array.isArray(embeddings) || embeddings.length !== texts.length ||
    embeddings.some((embedding) =>
      !Array.isArray(embedding) || embedding.length === 0 ||
      embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))
    )
  ) {
    throw new TypeError("Local embedding model returned an invalid result");
  }
  return embeddings;
}
