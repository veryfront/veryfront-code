/**
 * VoyageAI Embedding Provider
 */
import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.ts";
import type {
  EmbeddingDimension,
  EmbeddingRequest,
  EmbeddingResponse,
} from "../types.ts";

const VoyageAIEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number(),
      embedding: z.array(z.number()),
    }),
  ),
  model: z.string(),
  usage: z.object({
    total_tokens: z.number(),
  }),
});

export class VoyageAIEmbeddingProvider extends BaseEmbeddingProvider {
  name = "voyageai";
  defaultModel = "voyage-2";
  defaultDimension: EmbeddingDimension = 1024;

  protected getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  protected getEndpoint(): string {
    const baseURL = this.config.baseURL ?? "https://api.voyageai.com/v1";
    return `${baseURL}/embeddings`;
  }

  protected transformRequest(request: EmbeddingRequest): Record<string, unknown> {
    const model = request.model ?? this.config.model ?? this.defaultModel;

    return {
      model,
      input: request.inputs,
      input_type: "document", // For semantic search indexing
    };
  }

  protected transformResponse(response: unknown, _model: string): EmbeddingResponse {
    const parsed = VoyageAIEmbeddingResponseSchema.parse(response);
    const dimension = parsed.data[0]?.embedding.length ?? this.defaultDimension;

    return {
      embeddings: parsed.data.map((d) => ({
        index: d.index,
        embedding: d.embedding,
      })),
      model: parsed.model,
      dimension,
      usage: {
        promptTokens: parsed.usage.total_tokens,
        totalTokens: parsed.usage.total_tokens,
      },
    };
  }
}
