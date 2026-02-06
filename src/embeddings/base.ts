import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { requireApiKey } from "#veryfront/utils/api-key-validation.ts";
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
    requireApiKey(this.name, this.config.apiKey, "config");
  }

  protected abstract getHeaders(): Record<string, string>;
  protected abstract getEndpoint(): string;
  protected abstract transformRequest(request: EmbeddingRequest): Record<string, unknown>;
  protected abstract transformResponse(response: unknown, model: string): EmbeddingResponse;

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        ...this.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.transformRequest(request)),
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

  async embedBatch(inputs: string[]): Promise<EmbeddingResponse> {
    const batchSize = this.config.batchSize ?? 100;
    if (inputs.length <= batchSize) return this.embed({ inputs });

    const embeddings: EmbeddingResponse["embeddings"] = [];
    let promptTokens = 0;
    let totalTokens = 0;
    let model = "";
    let dimension = 0;

    for (let i = 0; i < inputs.length; i += batchSize) {
      const response = await this.embed({ inputs: inputs.slice(i, i + batchSize) });

      for (const { index, embedding } of response.embeddings) {
        embeddings.push({ index: index + i, embedding });
      }

      model = response.model;
      dimension = response.dimension;

      const { usage } = response;
      if (usage) {
        promptTokens += usage.promptTokens;
        totalTokens += usage.totalTokens;
      }
    }

    return {
      embeddings,
      model,
      dimension,
      usage: {
        promptTokens,
        totalTokens,
      },
    };
  }
}
