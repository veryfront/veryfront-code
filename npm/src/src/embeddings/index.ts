import "../../_dnt.polyfills.js";
import { createError, toError } from "../errors/veryfront-error.js";
import type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
import { CohereEmbeddingProvider } from "./providers/cohere.js";
import { OpenAIEmbeddingProvider } from "./providers/openai.js";
import { VoyageAIEmbeddingProvider } from "./providers/voyageai.js";

export type {
  EmbeddingDimension,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingResult,
} from "./types.js";
export { BaseEmbeddingProvider } from "./base.js";
export { OpenAIEmbeddingProvider } from "./providers/openai.js";
export { CohereEmbeddingProvider } from "./providers/cohere.js";
export { VoyageAIEmbeddingProvider } from "./providers/voyageai.js";

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
