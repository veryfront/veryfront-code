/**
 * Base embedding provider
 */
import * as dntShim from "../../_dnt.shims.js";
import { createError, toError } from "../errors/veryfront-error.js";
export class BaseEmbeddingProvider {
    config;
    constructor(config) {
        this.config = config;
        this.validateConfig();
    }
    validateConfig() {
        if (this.config.apiKey)
            return;
        throw toError(createError({
            type: "config",
            message: `${this.name}: API key is required`,
        }));
    }
    async embed(request) {
        const response = await dntShim.fetch(this.getEndpoint(), {
            method: "POST",
            headers: {
                ...this.getHeaders(),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(this.transformRequest(request)),
        });
        if (!response.ok) {
            const error = await response.text();
            throw toError(createError({
                type: "agent",
                message: `${this.name} embedding API error (${response.status}): ${error}`,
            }));
        }
        const data = await response.json();
        const model = request.model ?? this.config.model ?? this.defaultModel;
        return this.transformResponse(data, model);
    }
    /**
     * Batch embed with automatic chunking
     */
    async embedBatch(inputs) {
        const batchSize = this.config.batchSize ?? 100;
        if (inputs.length <= batchSize)
            return this.embed({ inputs });
        const embeddings = [];
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
            const usage = response.usage;
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
