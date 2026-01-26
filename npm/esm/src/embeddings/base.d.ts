import type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig, EmbeddingRequest, EmbeddingResponse } from "./types.js";
export declare abstract class BaseEmbeddingProvider implements EmbeddingProvider {
    abstract name: string;
    abstract defaultModel: string;
    abstract defaultDimension: EmbeddingDimension;
    protected config: EmbeddingProviderConfig;
    constructor(config: EmbeddingProviderConfig);
    protected validateConfig(): void;
    protected abstract getHeaders(): Record<string, string>;
    protected abstract getEndpoint(): string;
    protected abstract transformRequest(request: EmbeddingRequest): Record<string, unknown>;
    protected abstract transformResponse(response: unknown, model: string): EmbeddingResponse;
    embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
    /**
     * Batch embed with automatic chunking
     */
    embedBatch(inputs: string[]): Promise<EmbeddingResponse>;
}
//# sourceMappingURL=base.d.ts.map