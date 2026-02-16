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
  dtype: "q4" | "q8" | "fp32";
  /** Approximate download size in MB */
  sizeMB: number;
  /** Human-readable description */
  description: string;
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
};

/** Default model used when no specific model ID is provided */
export const DEFAULT_LOCAL_MODEL = "smollm2-135m";

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
