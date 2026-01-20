/**
 * Base embedding provider
 */
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  EmbeddingDimension,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  EmbeddingRequest,
  EmbeddingResponse,
} from "./types.ts";

export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  abstract name: string;
  abstract defaultModel: string;
  abstract defaultDimension: EmbeddingDimension;

  protected config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
    this.validateConfig();
  }

  protected validateConfig(): void {
    if (!this.config.apiKey) {
      throw toError(
        createError({
          type: "config",
          message: `${this.name}: API key is required`,
        }),
      );
    }
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract getEndpoint(): string;
  protected abstract transformRequest(request: EmbeddingRequest): Record<string, unknown>;
  protected abstract transformResponse(response: unknown, model: string): EmbeddingResponse;

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const endpoint = this.getEndpoint();
    const headers = this.getHeaders();
    const body = this.transformRequest(request);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw toError(
        createError({
          type: "agent",
          message: `${this.name} embedding API error (${response.status}): ${error}`,
        }),
      );
    }

    const data = await response.json();
    const model = request.model ?? this.config.model ?? this.defaultModel;
    return this.transformResponse(data, model);
  }

  /**
   * Batch embed with automatic chunking
   */
  async embedBatch(inputs: string[]): Promise<EmbeddingResponse> {
    const batchSize = this.config.batchSize ?? 100;

    if (inputs.length <= batchSize) {
      return this.embed({ inputs });
    }

    // Process in batches
    const allEmbeddings: EmbeddingResponse["embeddings"] = [];
    let totalPromptTokens = 0;
    let totalTokens = 0;
    let model = "";
    let dimension = 0;

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const response = await this.embed({ inputs: batch });

      // Adjust indices for concatenation
      for (const embedding of response.embeddings) {
        allEmbeddings.push({
          index: embedding.index + i,
          embedding: embedding.embedding,
        });
      }

      model = response.model;
      dimension = response.dimension;
      if (response.usage) {
        totalPromptTokens += response.usage.promptTokens;
        totalTokens += response.usage.totalTokens;
      }
    }

    return {
      embeddings: allEmbeddings,
      model,
      dimension,
      usage: {
        promptTokens: totalPromptTokens,
        totalTokens,
      },
    };
  }
}
