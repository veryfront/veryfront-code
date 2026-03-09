import {
  getDefaultVeryfrontCloudEmbeddingModel,
  isVeryfrontCloudEnabled,
} from "#veryfront/platform/cloud/resolver.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from "#veryfront/provider/local/model-catalog.ts";

export const AUTO_EMBEDDING_MODEL = "auto";

export function normalizeEmbeddingModelConfig(model?: string): string {
  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_EMBEDDING_MODEL;
}

export function resolveConfiguredEmbeddingModel(model?: string): string {
  const normalized = normalizeEmbeddingModelConfig(model);
  if (normalized !== AUTO_EMBEDDING_MODEL) {
    return normalized;
  }

  return isVeryfrontCloudEnabled()
    ? getDefaultVeryfrontCloudEmbeddingModel()
    : `local/${DEFAULT_LOCAL_EMBEDDING_MODEL}`;
}
