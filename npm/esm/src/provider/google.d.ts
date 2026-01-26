/**** Google AI provider implementation */
import { BaseProvider } from "./base.js";
import type { CompletionRequest, CompletionResponse, GoogleConfig } from "./types.js";
export declare class GoogleProvider extends BaseProvider {
    name: string;
    private apiKey;
    private baseURL;
    constructor(config: GoogleConfig);
    protected getHeaders(): Record<string, string>;
    protected getEndpoint(_path: string): string;
    protected transformRequest(request: CompletionRequest): Record<string, unknown>;
    protected transformResponse(response: unknown): CompletionResponse;
}
//# sourceMappingURL=google.d.ts.map