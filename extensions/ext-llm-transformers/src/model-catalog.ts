/**
 * Local Model Catalog
 *
 * Maps friendly model IDs to HuggingFace model repository IDs.
 * Used by the local inference engine to resolve model names.
 *
 * @module extensions/ext-llm-transformers
 */

import { createError, toError } from "veryfront/errors";

export interface ModelInfo {
  /** HuggingFace model repository ID */
  hfId: string;
  /** Quantization dtype for ONNX Runtime */
  dtype: ModelDType | Record<string, ModelDType>;
  /** Runtime path required by the model. */
  engine?: "text-generation" | "conditional-generation";
  /** Transformers.js model class used by conditional-generation models. */
  modelClass?: "gemma4" | "qwen3_5";
  /** Approximate download size in MB */
  sizeMB: number;
  /** Human-readable description */
  description: string;
  /** Pooling strategy for embedding models (default: "mean") */
  pooling?: "mean" | "last_token";
}

export type ModelDType = "q4" | "q8" | "q4f16" | "fp16" | "fp32";

/**
 * Catalog of supported local models.
 *
 * Keep this list intentionally small. Local model support means the model has
 * been smoke-tested through the Veryfront local runtime.
 */
const MODEL_CATALOG: Record<string, ModelInfo> = {
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
};

/** Default model used when no specific model ID is provided */
export const DEFAULT_LOCAL_MODEL = "qwen3.5-0.8b";

/**
 * Catalog of supported local embedding models.
 *
 * Uses the same `q4` quantization as language models for consistency.
 */
const EMBEDDING_MODEL_CATALOG: Record<string, ModelInfo> = {
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
};

/** Default embedding model used when no specific model ID is provided */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "all-MiniLM-L6-v2";

const MAX_REPOSITORY_ID_LENGTH = 96;
const REPOSITORY_ID_PART_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function isExplicitRepositoryId(modelId: string): boolean {
  if (
    modelId.length === 0 ||
    modelId.length > MAX_REPOSITORY_ID_LENGTH ||
    modelId !== modelId.trim() ||
    modelId.includes("..") ||
    modelId.includes("--") ||
    modelId.endsWith(".git") ||
    modelId.endsWith(".ipynb")
  ) {
    return false;
  }
  const parts = modelId.split("/");
  return parts.length === 2 && parts.every((part) => REPOSITORY_ID_PART_PATTERN.test(part));
}

function copyModelInfo(model: ModelInfo): ModelInfo {
  return {
    ...model,
    dtype: typeof model.dtype === "string" ? model.dtype : { ...model.dtype },
  };
}

function modelIdForError(value: unknown): string {
  if (typeof value !== "string") return `<${typeof value}>`;
  const bounded = value.length <= 128 ? value : `${value.slice(0, 128)}…`;
  return JSON.stringify(bounded);
}

/**
 * Resolve a curated embedding alias or an explicit `owner/model` repository
 * identifier. Unknown bare aliases are rejected so typos cannot silently
 * become remote model lookups.
 */
export function resolveLocalEmbeddingModel(modelId: string): ModelInfo {
  if (typeof modelId !== "string") {
    throw toError(createError({
      type: "config",
      message: `Unsupported local embedding model ${modelIdForError(modelId)}. ` +
        "Use a curated alias or an explicit owner/model repository identifier.",
    }));
  }
  const catalogEntry = Object.hasOwn(EMBEDDING_MODEL_CATALOG, modelId)
    ? EMBEDDING_MODEL_CATALOG[modelId]
    : undefined;
  if (catalogEntry) return copyModelInfo(catalogEntry);

  if (!isExplicitRepositoryId(modelId)) {
    throw toError(createError({
      type: "config",
      message: `Unsupported local embedding model ${
        modelIdForError(modelId)
      }. Use a curated alias (${
        getLocalEmbeddingModelIds().join(
          ", ",
        )
      }) or an explicit "owner/model" repository identifier.`,
    }));
  }

  return {
    hfId: modelId,
    dtype: "q4",
    sizeMB: 0,
    description: `Custom embedding model: ${modelId}`,
  };
}

/** Get the curated local embedding model aliases. */
export function getLocalEmbeddingModelIds(): string[] {
  return Object.keys(EMBEDDING_MODEL_CATALOG);
}

/**
 * Resolve a supported local model ID to its HuggingFace model info.
 */
export function resolveLocalModel(modelId: string): ModelInfo {
  const catalogEntry = typeof modelId === "string" && Object.hasOwn(MODEL_CATALOG, modelId)
    ? MODEL_CATALOG[modelId]
    : undefined;
  if (catalogEntry) return copyModelInfo(catalogEntry);

  throw toError(createError({
    type: "config",
    message: `Unsupported local model ${modelIdForError(modelId)}. Supported local models: ${
      getLocalModelIds().join(", ")
    }.`,
  }));
}

/**
 * Get all available local model IDs.
 */
export function getLocalModelIds(): string[] {
  return Object.keys(MODEL_CATALOG);
}
