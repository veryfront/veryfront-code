/**
 * Local Model Catalog
 *
 * Maps friendly model IDs to HuggingFace model repository IDs.
 * Used by the local inference engine to resolve model names.
 *
 * @module provider/local
 */

import { createError, toError } from "#veryfront/errors";

export interface ModelInfo {
  /** HuggingFace model repository ID */
  readonly hfId: string;
  /** Quantization dtype for ONNX Runtime */
  readonly dtype: ModelDType | Readonly<Record<string, ModelDType>>;
  /** Runtime path required by the model. */
  readonly engine?: "text-generation" | "conditional-generation";
  /** Transformers.js model class used by conditional-generation models. */
  readonly modelClass?: "gemma4" | "qwen3_5";
  /** Approximate download size in MB */
  readonly sizeMB: number;
  /** Human-readable description */
  readonly description: string;
  /** Pooling strategy for embedding models (default: "mean") */
  readonly pooling?: "mean" | "last_token";
}

export type ModelDType = "q4" | "q8" | "q4f16" | "fp16" | "fp32";

/**
 * Catalog of supported local models.
 *
 * Keep this list intentionally small. Local model support means the model has
 * been smoke-tested through the Veryfront local runtime.
 */
function freezeModelCatalog(
  entries: Record<string, ModelInfo>,
): Readonly<Record<string, ModelInfo>> {
  for (const model of Object.values(entries)) {
    if (typeof model.dtype === "object") Object.freeze(model.dtype);
    Object.freeze(model);
  }
  return Object.freeze(entries);
}

const MODEL_CATALOG = freezeModelCatalog({
  "qwen3.5-0.8b": {
    hfId: "onnx-community/Qwen3.5-0.8B-ONNX",
    dtype: {
      embed_tokens: "q4",
      vision_encoder: "fp16",
      decoder_model_merged: "q4",
    },
    engine: "conditional-generation",
    modelClass: "qwen3_5",
    sizeMB: 900,
    description: "Qwen3.5 0.8B - compact current-generation Qwen model",
  },
  "gemma4-e2b-it": {
    hfId: "onnx-community/gemma-4-E2B-it-ONNX",
    dtype: "q4",
    engine: "conditional-generation",
    modelClass: "gemma4",
    sizeMB: 1800,
    description: "Gemma 4 E2B IT - compact current-generation Gemma model",
  },
  "gemma4-e4b-it": {
    hfId: "onnx-community/gemma-4-E4B-it-ONNX",
    dtype: "q4",
    engine: "conditional-generation",
    modelClass: "gemma4",
    sizeMB: 6000,
    description: "Gemma 4 E4B IT - larger current-generation Gemma model",
  },
});

/** Default model used when no specific model ID is provided */
export const DEFAULT_LOCAL_MODEL = "qwen3.5-0.8b";

/**
 * Catalog of supported local embedding models.
 *
 * Uses the same `q4` quantization as language models for consistency.
 */
const EMBEDDING_MODEL_CATALOG = freezeModelCatalog({
  "all-MiniLM-L6-v2": {
    hfId: "Xenova/all-MiniLM-L6-v2",
    dtype: "q4",
    sizeMB: 23,
    description: "All-MiniLM-L6-v2 - fast 384-dim embeddings",
  },
  "nomic-embed-text-v1.5": {
    hfId: "nomic-ai/nomic-embed-text-v1.5",
    dtype: "q4",
    sizeMB: 130,
    description: "Nomic Embed Text v1.5 - 768-dim, variable-length embeddings",
  },
  "bge-base-en-v1.5": {
    hfId: "Xenova/bge-base-en-v1.5",
    dtype: "q4",
    sizeMB: 110,
    description: "BGE Base EN v1.5 - 768-dim, strong English embeddings",
  },
  "qwen3-embedding-0.6b": {
    hfId: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dtype: "q8",
    sizeMB: 620,
    pooling: "last_token",
    description: "Qwen3 Embedding 0.6B - SOTA multilingual embeddings",
  },
});

/** Default embedding model used when no specific model ID is provided */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "all-MiniLM-L6-v2";

/**
 * Resolve a friendly embedding model ID to its HuggingFace model info.
 * Falls back to treating the ID as a raw HuggingFace repository ID.
 */
export function resolveLocalEmbeddingModel(modelId: string): ModelInfo {
  const catalogEntry = Object.hasOwn(EMBEDDING_MODEL_CATALOG, modelId)
    ? EMBEDDING_MODEL_CATALOG[modelId]
    : undefined;
  if (catalogEntry) return catalogEntry;

  if (
    typeof modelId !== "string" || modelId.length === 0 || modelId.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/u.test(modelId) ||
    modelId.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw toError(createError({
      type: "config",
      message: "Custom local embedding model ID is invalid.",
    }));
  }

  return Object.freeze({
    hfId: modelId,
    dtype: "q4",
    sizeMB: 0,
    description: `Custom embedding model: ${modelId}`,
  });
}

/**
 * Resolve a supported local model ID to its HuggingFace model info.
 */
export function resolveLocalModel(modelId: string): ModelInfo {
  const catalogEntry = Object.hasOwn(MODEL_CATALOG, modelId) ? MODEL_CATALOG[modelId] : undefined;
  if (catalogEntry) return catalogEntry;

  throw toError(createError({
    type: "config",
    message: `Unsupported local model. Supported local models: ${getLocalModelIds().join(", ")}.`,
  }));
}

/**
 * Get all available local model IDs.
 */
export function getLocalModelIds(): string[] {
  return Object.keys(MODEL_CATALOG);
}
