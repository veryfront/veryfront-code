export type EmbeddingDimension = 768 | 1024 | 1536 | 3072 | 4096;

export interface EmbeddingProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  dimension?: EmbeddingDimension;
  batchSize?: number;
}

export interface EmbeddingRequest {
  inputs: string[];
  model?: string;
  dimension?: EmbeddingDimension;
}

export interface EmbeddingResult {
  index: number;
  embedding: number[];
}

export interface EmbeddingResponse {
  embeddings: EmbeddingResult[];
  model: string;
  dimension: number;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingProvider {
  name: string;
  defaultModel: string;
  defaultDimension: EmbeddingDimension;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
