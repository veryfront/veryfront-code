import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.js";
import type { EmbeddingDimension, EmbeddingRequest, EmbeddingResponse } from "../types.js";

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
    return { Authorization: `Bearer ${this.config.apiKey}` };
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
      input_type: "document",
    };
  }

  protected transformResponse(response: unknown): EmbeddingResponse {
    const parsed = VoyageAIEmbeddingResponseSchema.parse(response);
    const dimension = parsed.data[0]?.embedding.length ?? this.defaultDimension;
    const totalTokens = parsed.usage.total_tokens;

    return {
      embeddings: parsed.data.map(({ index, embedding }) => ({ index, embedding })),
      model: parsed.model,
      dimension,
      usage: {
        promptTokens: totalTokens,
        totalTokens,
      },
    };
  }
}
