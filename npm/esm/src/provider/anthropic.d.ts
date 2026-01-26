/** Anthropic provider implementation */
import { BaseProvider } from "./base.js";
import type { AnthropicConfig, CompletionRequest, CompletionResponse } from "./types.js";
interface AnthropicTextContent {
    type: "text";
    text: string;
}
interface AnthropicToolUseContent {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}
interface AnthropicToolResultContent {
    type: "tool_result";
    tool_use_id: string;
    content: string;
}
type AnthropicContentBlock = AnthropicTextContent | AnthropicToolUseContent | AnthropicToolResultContent;
interface AnthropicResponse {
    content: AnthropicContentBlock[];
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
    };
    stop_reason: string;
}
export declare class AnthropicProvider extends BaseProvider {
    name: string;
    private apiKey;
    private baseURL;
    constructor(config: AnthropicConfig);
    protected getHeaders(): Record<string, string>;
    protected getEndpoint(_path: string): string;
    protected transformRequest(request: CompletionRequest): Record<string, unknown>;
    protected transformResponse(response: AnthropicResponse): CompletionResponse;
    private mapStopReason;
    protected transformStream(stream: ReadableStream): ReadableStream;
}
export {};
//# sourceMappingURL=anthropic.d.ts.map