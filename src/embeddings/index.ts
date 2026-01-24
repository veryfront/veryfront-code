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
  if (type === "openai") return new OpenAIEmbeddingProvider(config);
  if (type === "cohere") return new CohereEmbeddingProvider(config);
  if (type === "voyageai") return new VoyageAIEmbeddingProvider(config);

  if (type === "custom") {
    throw toError(
      createError({
        type: "config",
        message:
          "Custom embedding provider requires manual instantiation. Extend BaseEmbeddingProvider.",
      }),
    );
  }

  throw toError(
    createError({
      type: "config",
      message: `Unknown embedding provider: ${type}`,
    }),
  );
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

  return createEmbeddingProvider(embedding.provider, {
    apiKey: embedding.apiKey,
    model: embedding.model,
    dimension: embedding.dimension,
    batchSize: embedding.batchSize,
  });
}
