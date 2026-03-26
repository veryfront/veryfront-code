import {
  getDefaultVeryfrontCloudEmbeddingModel,
  isVeryfrontCloudEnabled,
} from "#veryfront/platform/cloud/resolver.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from "#veryfront/provider/local/model-catalog.ts";
import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export const AUTO_EMBEDDING_MODEL = "auto";

export function normalizeEmbeddingModelConfig(model?: string): string {
  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_EMBEDDING_MODEL;
}

/**
 * Resolve the best available cloud embedding model from environment API keys.
 * Returns `undefined` if no cloud provider is configured.
 */
function resolveCloudEmbeddingFallback(): string | undefined {
  if (getEnv("OPENAI_API_KEY")) return "openai/text-embedding-3-small";
  if (getEnv("GOOGLE_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY")) {
    return "google/text-embedding-004";
  }
  return undefined;
}

export function resolveConfiguredEmbeddingModel(model?: string): string {
  const normalized = normalizeEmbeddingModelConfig(model);
  if (normalized !== AUTO_EMBEDDING_MODEL) {
    return normalized;
  }

  if (isVeryfrontCloudEnabled()) {
    return getDefaultVeryfrontCloudEmbeddingModel();
  }

  // Local ONNX Runtime is unavailable in compiled binaries — fall back to
  // a cloud embedding provider when API keys are present.
  if (isDenoCompiled) {
    const cloud = resolveCloudEmbeddingFallback();
    if (cloud) return cloud;
  }

  return `local/${DEFAULT_LOCAL_EMBEDDING_MODEL}`;
}
