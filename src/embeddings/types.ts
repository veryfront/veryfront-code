/**
 * Embedding provider types
 */

export type EmbeddingDimension = 768 | 1024 | 1536 | 3072 | 4096;

export interface EmbeddingProviderConfig {
  /** API key */
  apiKey?: string;

  /** Base URL (for custom endpoints) */
  baseURL?: string;

  /** Model name */
  model?: string;

  /** Vector dimension */
  dimension?: EmbeddingDimension;

  /** Batch size for embedding requests (default: 100) */
  batchSize?: number;
}

export interface EmbeddingRequest {
  /** Text inputs to embed */
  inputs: string[];

  /** Model name override */
  model?: string;

  /** Dimension override */
  dimension?: EmbeddingDimension;
}

export interface EmbeddingResult {
  /** Index in input array */
  index: number;

  /** Embedding vector */
  embedding: number[];
}

export interface EmbeddingResponse {
  /** Embedding results */
  embeddings: EmbeddingResult[];

  /** Model used */
  model: string;

  /** Vector dimension */
  dimension: number;

  /** Usage statistics */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingProvider {
  /** Provider name */
  name: string;

  /** Default model */
  defaultModel: string;

  /** Default dimension */
  defaultDimension: EmbeddingDimension;

  /**
   * Generate embeddings for text inputs
   */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
