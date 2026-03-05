/**
 * Local Model Catalog
 *
 * Maps friendly model IDs to HuggingFace model repository IDs.
 * Used by the local inference engine to resolve model names.
 *
 * @module provider/local
 */

export interface ModelInfo {
  /** HuggingFace model repository ID */
  hfId: string;
  /** Quantization dtype for ONNX Runtime */
  dtype: "q4" | "q8" | "fp16" | "fp32";
  /** Approximate download size in MB */
  sizeMB: number;
  /** Human-readable description */
  description: string;
  /** Pooling strategy for embedding models (default: "mean") */
  pooling?: "mean" | "last_token";
}

/**
 * Catalog of supported local models.
 *
 * **Important:** Only `q4` quantization is used — `q4f16` has a known
 * ONNX Runtime bug with LayerNorm on CPU that produces NaN outputs.
 */
const MODEL_CATALOG: Record<string, ModelInfo> = {
  "smollm2-135m": {
    hfId: "HuggingFaceTB/SmolLM2-135M-Instruct",
    dtype: "q4",
    sizeMB: 100,
    description: "SmolLM2 135M — fast, lightweight chat model",
  },
  "smollm2-360m": {
    hfId: "HuggingFaceTB/SmolLM2-360M-Instruct",
    dtype: "q4",
    sizeMB: 250,
    description: "SmolLM2 360M — better quality, still fast",
  },
  "smollm2-1.7b": {
    hfId: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
    dtype: "q4",
    sizeMB: 1000,
    description: "SmolLM2 1.7B — highest quality local model",
  },
  "qwen3-1.7b": {
    hfId: "onnx-community/Qwen3-1.7B-ONNX",
    dtype: "q4",
    sizeMB: 1200,
    description: "Qwen3 1.7B — strong multilingual reasoning and tool use",
  },
  "gemma3-1b": {
    hfId: "onnx-community/gemma-3-1b-it-ONNX",
    dtype: "q4",
    sizeMB: 700,
    description: "Gemma 3 1B — Google's compact instruction-tuned model",
  },
};

/** Default model used when no specific model ID is provided */
export const DEFAULT_LOCAL_MODEL = "smollm2-135m";

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
    description: "All-MiniLM-L6-v2 — fast 384-dim embeddings",
  },
  "nomic-embed-text-v1.5": {
    hfId: "nomic-ai/nomic-embed-text-v1.5",
    dtype: "q4",
    sizeMB: 130,
    description: "Nomic Embed Text v1.5 — 768-dim, variable-length embeddings",
  },
  "bge-base-en-v1.5": {
    hfId: "Xenova/bge-base-en-v1.5",
    dtype: "q4",
    sizeMB: 110,
    description: "BGE Base EN v1.5 — 768-dim, strong English embeddings",
  },
  "qwen3-embedding-0.6b": {
    hfId: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    dtype: "q8",
    sizeMB: 620,
    pooling: "last_token",
    description: "Qwen3 Embedding 0.6B — SOTA multilingual embeddings",
  },
};

/** Default embedding model used when no specific model ID is provided */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "all-MiniLM-L6-v2";

/**
 * Resolve a friendly embedding model ID to its HuggingFace model info.
 * Falls back to treating the ID as a raw HuggingFace repository ID.
 */
export function resolveLocalEmbeddingModel(modelId: string): ModelInfo {
  const catalogEntry = EMBEDDING_MODEL_CATALOG[modelId];
  if (catalogEntry) return catalogEntry;

  return {
    hfId: modelId,
    dtype: "q4",
    sizeMB: 0,
    description: `Custom embedding model: ${modelId}`,
  };
}

/**
 * Resolve a friendly model ID to its HuggingFace model info.
 * Falls back to treating the ID as a raw HuggingFace repository ID.
 */
export function resolveLocalModel(modelId: string): ModelInfo {
  const catalogEntry = MODEL_CATALOG[modelId];
  if (catalogEntry) return catalogEntry;

  // Treat as raw HuggingFace model ID (e.g. "HuggingFaceTB/SmolLM2-135M-Instruct")
  return {
    hfId: modelId,
    dtype: "q4",
    sizeMB: 0,
    description: `Custom model: ${modelId}`,
  };
}

/**
 * Get all available local model IDs.
 */
export function getLocalModelIds(): string[] {
  return Object.keys(MODEL_CATALOG);
}
