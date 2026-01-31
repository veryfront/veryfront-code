import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.ts";
import type { EmbeddingDimension, EmbeddingRequest, EmbeddingResponse } from "../types.ts";

const OpenAIEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number(),
      embedding: z.array(z.number()),
    }),
  ),
  model: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    total_tokens: z.number(),
  }),
});

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  name = "openai";
  defaultModel = "text-embedding-3-small";
  defaultDimension: EmbeddingDimension = 1536;

  protected getHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  protected getEndpoint(): string {
    return `${this.config.baseURL ?? "https://api.openai.com/v1"}/embeddings`;
  }

  protected transformRequest(request: EmbeddingRequest): Record<string, unknown> {
    const model = request.model ?? this.config.model ?? this.defaultModel;
    const dimension = request.dimension ?? this.config.dimension ?? this.defaultDimension;

    const body: Record<string, unknown> = { model, input: request.inputs };

    if (model.startsWith("text-embedding-3")) {
      body.dimensions = dimension;
    }

    return body;
  }

  protected transformResponse(response: unknown): EmbeddingResponse {
    const parsed = OpenAIEmbeddingResponseSchema.parse(response);
    const dimension = parsed.data[0]?.embedding.length ?? this.defaultDimension;

    return {
      embeddings: parsed.data.map(({ index, embedding }) => ({ index, embedding })),
      model: parsed.model,
      dimension,
      usage: {
        promptTokens: parsed.usage.prompt_tokens,
        totalTokens: parsed.usage.total_tokens,
      },
    };
  }
}
