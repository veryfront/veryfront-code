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
import { getLocalInferenceDevice, getTransformers } from "./local-engine.ts";
import { createPipelineCache } from "./pipeline-cache.ts";

const logger = serverLogger.component("local-embedding");

interface EmbeddingOutput {
  tolist(): unknown;
  dispose(): void;
}

interface Pipeline {
  (texts: string[], options: { pooling: string; normalize: boolean }): Promise<EmbeddingOutput>;
  dispose(): void | Promise<void>;
}

export const LOCAL_EMBEDDING_BATCH_SIZE = 32;

export function validateLocalEmbeddingBatch(
  value: unknown,
  expectedCount: number,
  expectedDimension?: number,
): { embeddings: number[][]; dimension: number } {
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    throw new RangeError("expectedCount must be a positive safe integer");
  }
  if (
    expectedDimension !== undefined &&
    (!Number.isSafeInteger(expectedDimension) || expectedDimension <= 0)
  ) {
    throw new RangeError("expectedDimension must be a positive safe integer");
  }
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new TypeError(
      "Local embedding pipeline returned an unexpected number of vectors",
    );
  }

  let dimension = expectedDimension;
  const embeddings: number[][] = [];
  for (const vector of value) {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new TypeError(
        "Local embedding pipeline returned an invalid vector",
      );
    }
    for (let index = 0; index < vector.length; index++) {
      const coordinate = vector[index];
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
        throw new TypeError(
          "Local embedding pipeline returned an invalid vector",
        );
      }
    }
    dimension ??= vector.length;
    if (vector.length !== dimension) {
      throw new TypeError(
        "Local embedding pipeline returned inconsistent vector dimensions",
      );
    }
    embeddings.push(vector);
  }

  if (dimension === undefined) {
    throw new TypeError("Local embedding pipeline returned no vectors");
  }
  return { embeddings, dimension };
}

type EmbeddingModelLoadInfo = ModelInfo & {
  device: "cpu" | "webgpu";
};

/**
 * Bounded, dedup-aware cache of feature-extraction pipelines keyed by
 * HuggingFace model id. Only loads a model on a cold cache miss; concurrent
 * loads of the same model share a single promise.
 */
const embeddingPipelines = createPipelineCache<Pipeline, EmbeddingModelLoadInfo>(
  async (modelInfo) => {
    const transformers = await getTransformers();

    logger.info(
      `Loading local embedding model: ${modelInfo.hfId} (${modelInfo.dtype}, ${modelInfo.device}, ~${modelInfo.sizeMB}MB)...`,
    );

    const pipe = (await transformers.pipeline(
      "feature-extraction",
      modelInfo.hfId,
      {
        dtype: modelInfo.dtype,
        device: modelInfo.device,
      },
    )) as Pipeline;

    logger.info(`Embedding model loaded: ${modelInfo.hfId}`);
    return pipe;
  },
  {
    dispose: async (pipeline) => {
      await pipeline.dispose();
    },
  },
);

/**
 * Load a feature-extraction pipeline for the given model.
 * Returns a cached pipeline if already loaded.
 */
async function acquirePipeline(modelInfo: ModelInfo, abortSignal?: AbortSignal) {
  throwIfAborted(abortSignal);
  const device = await getLocalInferenceDevice();
  throwIfAborted(abortSignal);
  const loadInfo: EmbeddingModelLoadInfo = { ...modelInfo, device };
  return await embeddingPipelines.acquire(
    `${modelInfo.hfId}:${device}`,
    loadInfo,
    abortSignal,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
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
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  throwIfAborted(abortSignal);
  if (texts.length === 0) return [];

  const modelInfo = resolveLocalEmbeddingModel(modelId);
  const lease = await acquirePipeline(modelInfo, abortSignal);

  try {
    throwIfAborted(abortSignal);
    const pooling = modelInfo.pooling ?? "mean";
    const embeddings: number[][] = [];
    let embeddingDimension: number | undefined;

    for (let index = 0; index < texts.length; index += LOCAL_EMBEDDING_BATCH_SIZE) {
      throwIfAborted(abortSignal);
      const batch = texts.slice(index, index + LOCAL_EMBEDDING_BATCH_SIZE);
      const output = await lease.value(batch, { pooling, normalize: true });
      try {
        throwIfAborted(abortSignal);
        const validated = validateLocalEmbeddingBatch(
          output.tolist(),
          batch.length,
          embeddingDimension,
        );
        embeddingDimension = validated.dimension;
        embeddings.push(...validated.embeddings);
      } finally {
        output.dispose();
      }
    }

    throwIfAborted(abortSignal);
    return embeddings;
  } finally {
    await lease.release();
  }
}
