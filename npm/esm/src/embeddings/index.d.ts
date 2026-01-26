import "../../_dnt.polyfills.js";
import type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";
export type { EmbeddingDimension, EmbeddingProvider, EmbeddingProviderConfig, EmbeddingRequest, EmbeddingResponse, EmbeddingResult, } from "./types.js";
export { BaseEmbeddingProvider } from "./base.js";
export { OpenAIEmbeddingProvider } from "./providers/openai.js";
export { CohereEmbeddingProvider } from "./providers/cohere.js";
export { VoyageAIEmbeddingProvider } from "./providers/voyageai.js";
export type EmbeddingProviderType = "openai" | "cohere" | "voyageai" | "custom";
export declare function createEmbeddingProvider(type: EmbeddingProviderType, config: EmbeddingProviderConfig): EmbeddingProvider;
export declare function createEmbeddingProviderFromConfig(searchConfig: {
    embedding?: {
        provider?: EmbeddingProviderType;
        model?: string;
        dimension?: EmbeddingDimension;
        apiKey?: string;
        batchSize?: number;
    };
}): EmbeddingProvider | null;
//# sourceMappingURL=index.d.ts.map