import { BaseEmbeddingProvider } from "../base.js";
import type { EmbeddingDimension, EmbeddingRequest, EmbeddingResponse } from "../types.js";
export declare class VoyageAIEmbeddingProvider extends BaseEmbeddingProvider {
    name: string;
    defaultModel: string;
    defaultDimension: EmbeddingDimension;
    protected getHeaders(): Record<string, string>;
    protected getEndpoint(): string;
    protected transformRequest(request: EmbeddingRequest): Record<string, unknown>;
    protected transformResponse(response: unknown): EmbeddingResponse;
}
//# sourceMappingURL=voyageai.d.ts.map