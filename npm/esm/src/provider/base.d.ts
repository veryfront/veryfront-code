import type { CompletionRequest, CompletionResponse, Provider, ProviderConfig } from "./types.js";
export declare function mapFinishReason(reason: string): CompletionResponse["finishReason"];
export declare abstract class BaseProvider implements Provider {
    abstract name: string;
    protected config: ProviderConfig;
    constructor(config: ProviderConfig);
    protected validateConfig(): void;
    protected abstract getHeaders(): Record<string, string>;
    protected abstract getEndpoint(path: string): string;
    protected abstract transformRequest(request: CompletionRequest): Record<string, unknown>;
    protected abstract transformResponse(response: unknown): CompletionResponse;
    private postChatCompletions;
    complete(request: CompletionRequest): Promise<CompletionResponse>;
    stream(request: CompletionRequest): Promise<ReadableStream<Uint8Array>>;
    protected transformStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array>;
}
//# sourceMappingURL=base.d.ts.map