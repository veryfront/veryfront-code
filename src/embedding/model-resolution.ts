import {
  getDefaultVeryfrontCloudEmbeddingModel,
  isVeryfrontCloudEnabled,
} from "#veryfront/platform/cloud/resolver.ts";
import { createError, toError } from "#veryfront/errors";

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

  if (isVeryfrontCloudEnabled()) {
    return getDefaultVeryfrontCloudEmbeddingModel();
  }

  throw toError(
    createError({
      type: "config",
      message: 'Embedding model "auto" requires Veryfront Cloud. Configure an explicit ' +
        '"provider/model" and register that embedding provider during application composition.',
    }),
  );
}
