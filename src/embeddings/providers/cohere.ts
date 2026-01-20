/**
 * Cohere Embedding Provider
 */
import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.ts";
import type {
  EmbeddingDimension,
  EmbeddingRequest,
  EmbeddingResponse,
} from "../types.ts";

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
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  protected getEndpoint(): string {
    const baseURL = this.config.baseURL ?? "https://api.cohere.ai/v1";
    return `${baseURL}/embed`;
  }

  protected transformRequest(request: EmbeddingRequest): Record<string, unknown> {
    const model = request.model ?? this.config.model ?? this.defaultModel;

    return {
      model,
      texts: request.inputs,
      input_type: "search_document", // For semantic search
      truncate: "END",
    };
  }

  protected transformResponse(response: unknown, model: string): EmbeddingResponse {
    const parsed = CohereEmbeddingResponseSchema.parse(response);
    const dimension = parsed.embeddings[0]?.length ?? this.defaultDimension;
    const inputTokens = parsed.meta?.billed_units?.input_tokens ?? 0;

    return {
      embeddings: parsed.embeddings.map((embedding, index) => ({
        index,
        embedding,
      })),
      model,
      dimension,
      usage: {
        promptTokens: inputTokens,
        totalTokens: inputTokens,
      },
    };
  }
}
