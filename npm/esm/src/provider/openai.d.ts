import { BaseProvider } from "./base.js";
import type { CompletionRequest, CompletionResponse, OpenAIConfig } from "./types.js";
export declare class OpenAIProvider extends BaseProvider {
    name: string;
    constructor(config: OpenAIConfig);
    protected getHeaders(): Record<string, string>;
    protected getEndpoint(path: string): string;
    protected transformRequest(request: CompletionRequest): Record<string, unknown>;
    protected transformResponse(response: unknown): CompletionResponse;
    private formatMessages;
}
//# sourceMappingURL=openai.d.ts.map