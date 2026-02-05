// Re-export schema-based types
export type {
  EmbeddingDimension,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingResult,
  EmbeddingUsage,
} from "./schemas/index.ts";

export interface EmbeddingProvider {
  name: string;
  defaultModel: string;
  defaultDimension: EmbeddingDimension;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
