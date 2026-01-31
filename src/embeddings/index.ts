import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig } from "./types.ts";
import { CohereEmbeddingProvider } from "./providers/cohere.ts";
import { OpenAIEmbeddingProvider } from "./providers/openai.ts";
import { VoyageAIEmbeddingProvider } from "./providers/voyageai.ts";

export type {
  EmbeddingDimension,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingResult,
} from "./types.ts";
export { BaseEmbeddingProvider } from "./base.ts";
export { OpenAIEmbeddingProvider } from "./providers/openai.ts";
export { CohereEmbeddingProvider } from "./providers/cohere.ts";
export { VoyageAIEmbeddingProvider } from "./providers/voyageai.ts";

export type EmbeddingProviderType = "openai" | "cohere" | "voyageai" | "custom";

export function createEmbeddingProvider(
  type: EmbeddingProviderType,
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  switch (type) {
    case "openai":
      return new OpenAIEmbeddingProvider(config);
    case "cohere":
      return new CohereEmbeddingProvider(config);
    case "voyageai":
      return new VoyageAIEmbeddingProvider(config);
    case "custom":
      throw toError(
        createError({
          type: "config",
          message:
            "Custom embedding provider requires manual instantiation. Extend BaseEmbeddingProvider.",
        }),
      );
    default:
      throw toError(
        createError({
          type: "config",
          message: `Unknown embedding provider: ${type}`,
        }),
      );
  }
}

export function createEmbeddingProviderFromConfig(searchConfig: {
  embedding?: {
    provider?: EmbeddingProviderType;
    model?: string;
    dimension?: EmbeddingDimension;
    apiKey?: string;
    batchSize?: number;
  };
}): EmbeddingProvider | null {
  const embedding = searchConfig.embedding;
  if (!embedding?.provider || !embedding?.apiKey) return null;

  const { apiKey, provider, model, dimension, batchSize } = embedding;

  return createEmbeddingProvider(provider, {
    apiKey,
    model,
    dimension,
    batchSize,
  });
}
