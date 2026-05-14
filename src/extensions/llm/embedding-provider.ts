/**
 * Contract interface for text embedding providers.
 *
 * No default first-party implementation is currently shipped.
 *
 * @module extensions/llm/embedding-provider
 */

/** Options passed to {@link EmbeddingProvider.embed}. */
export interface EmbeddingOptions {
  /** Model identifier (e.g. `"text-embedding-3-small"`). */
  model: string;
  /** Input texts to embed. */
  input: string[];
  /** Additional provider-specific options. */
  [key: string]: unknown;
}

/** Result returned from {@link EmbeddingProvider.embed}. */
export interface EmbeddingResult {
  /** One embedding vector per input string. */
  embeddings: number[][];
  /** Token usage statistics. */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * EmbeddingProvider contract interface.
 *
 * Implementations convert text inputs into dense vector embeddings
 * for similarity search and retrieval-augmented generation.
 */
export interface EmbeddingProvider {
  /** Generate embedding vectors for the given input texts. */
  embed(options: EmbeddingOptions): Promise<EmbeddingResult>;
}
