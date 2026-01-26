import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.js";
const VoyageAIEmbeddingResponseSchema = z.object({
    data: z.array(z.object({
        index: z.number(),
        embedding: z.array(z.number()),
    })),
    model: z.string(),
    usage: z.object({
        total_tokens: z.number(),
    }),
});
export class VoyageAIEmbeddingProvider extends BaseEmbeddingProvider {
    name = "voyageai";
    defaultModel = "voyage-2";
    defaultDimension = 1024;
    getHeaders() {
        return { Authorization: `Bearer ${this.config.apiKey}` };
    }
    getEndpoint() {
        const baseURL = this.config.baseURL ?? "https://api.voyageai.com/v1";
        return `${baseURL}/embeddings`;
    }
    transformRequest(request) {
        const model = request.model ?? this.config.model ?? this.defaultModel;
        return {
            model,
            input: request.inputs,
            input_type: "document",
        };
    }
    transformResponse(response) {
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
