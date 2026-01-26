import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.js";
import type { EmbeddingDimension, EmbeddingRequest, EmbeddingResponse } from "../types.js";

const CohereEmbeddingResponseSchema = z.object({
  embeddings: z.array(z.array(z.number())),
  meta: z
    .object({
      billed_units: z
        .object({
          input_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export class CohereEmbeddingProvider extends BaseEmbeddingProvider {
  name = "cohere";
  defaultModel = "embed-english-v3.0";
  defaultDimension: EmbeddingDimension = 1024;

  protected getHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  protected getEndpoint(): string {
    return `${this.config.baseURL ?? "https://api.cohere.ai/v1"}/embed`;
  }

  protected transformRequest(request: EmbeddingRequest): Record<string, unknown> {
    return {
      model: request.model ?? this.config.model ?? this.defaultModel,
      texts: request.inputs,
      input_type: "search_document",
      truncate: "END",
    };
  }

  protected transformResponse(response: unknown, model: string): EmbeddingResponse {
    const { embeddings, meta } = CohereEmbeddingResponseSchema.parse(response);
    const dimension = embeddings[0]?.length ?? this.defaultDimension;
    const inputTokens = meta?.billed_units?.input_tokens ?? 0;

    return {
      embeddings: embeddings.map((embedding, index) => ({ index, embedding })),
      model,
      dimension,
      usage: {
        promptTokens: inputTokens,
        totalTokens: inputTokens,
      },
    };
  }
}
