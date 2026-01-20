/**
 * Embedding providers for semantic search
 *
 * @example
 * ```ts
 * import { createEmbeddingProvider } from "#veryfront/embeddings";
 *
 * const provider = createEmbeddingProvider("openai", {
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: "text-embedding-3-small",
 *   dimension: 1536,
 * });
 *
 * const response = await provider.embed({
 *   inputs: ["Hello world", "How are you?"],
 * });
 *
 * console.log(response.embeddings);
 * ```
 */
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig } from "./types.ts";
import { OpenAIEmbeddingProvider } from "./providers/openai.ts";
import { CohereEmbeddingProvider } from "./providers/cohere.ts";
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

/**
 * Create an embedding provider instance
 */
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

/**
 * Create an embedding provider from veryfront config
 */
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
  if (!embedding?.provider || !embedding?.apiKey) {
    return null;
  }

  return createEmbeddingProvider(embedding.provider, {
    apiKey: embedding.apiKey,
    model: embedding.model,
    dimension: embedding.dimension,
    batchSize: embedding.batchSize,
  });
}
