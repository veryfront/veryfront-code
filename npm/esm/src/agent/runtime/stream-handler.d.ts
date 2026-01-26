import type { AgentStreamEvent } from "../streaming/index.js";
export interface StreamingToolCall {
    id: string;
    name: string;
    arguments: string;
}
export interface StreamState {
    accumulatedText: string;
    finishReason: string | null;
    toolCalls: Map<string, StreamingToolCall>;
}
export interface StreamCallbacks {
    onChunk?: (chunk: string) => void;
    onUsage?: (usage: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    }) => void;
}
export declare function createStreamState(): StreamState;
export declare function handleStreamEvent(event: AgentStreamEvent, state: StreamState, controller: ReadableStreamDefaultController, encoder: TextEncoder, textPartId: string | undefined, callbacks?: StreamCallbacks): void;
export declare function processStreamData(stream: ReadableStream, state: StreamState, controller: ReadableStreamDefaultController, encoder: TextEncoder, textPartId: string | undefined, callbacks?: StreamCallbacks): Promise<void>;
//# sourceMappingURL=stream-handler.d.ts.map