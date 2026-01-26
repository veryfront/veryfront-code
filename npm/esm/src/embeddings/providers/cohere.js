import { z } from "zod";
import { BaseEmbeddingProvider } from "../base.js";
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
    defaultDimension = 1024;
    getHeaders() {
        return { Authorization: `Bearer ${this.config.apiKey}` };
    }
    getEndpoint() {
        return `${this.config.baseURL ?? "https://api.cohere.ai/v1"}/embed`;
    }
    transformRequest(request) {
        return {
            model: request.model ?? this.config.model ?? this.defaultModel,
            texts: request.inputs,
            input_type: "search_document",
            truncate: "END",
        };
    }
    transformResponse(response, model) {
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
