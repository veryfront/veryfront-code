/**
 * Agent Runtime - Core execution engine
 *
 * Handles agent execution with:
 * - Multi-step reasoning (agent loop)
 * - Tool calling and execution
 * - Streaming responses
 * - Memory management
 * - Middleware execution
 *
 * @module ai/agent/runtime
 */
import { type AgentConfig, type AgentResponse, type Message, type ToolCall } from "../types.js";
import { type Memory } from "../memory/index.js";
export { generateMessageId, sendSSE } from "./sse-utils.js";
export { getAvailableTools, isDynamicTool, parseToolArgs } from "./tool-helpers.js";
export type { ParsedToolArgs, ToolConfigEntry } from "./tool-helpers.js";
export { accumulateUsage, getMaxSteps, normalizeInput } from "./input-utils.js";
export { createStreamState, handleStreamEvent, processStreamData } from "./stream-handler.js";
export type { StreamCallbacks, StreamingToolCall, StreamState } from "./stream-handler.js";
export { DEFAULT_MAX_STEPS, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE, MAX_STREAM_BUFFER_SIZE, } from "./constants.js";
export declare class AgentRuntime {
    private id;
    private config;
    private memory;
    private status;
    constructor(id: string, config: AgentConfig);
    /**
     * Generate a response (non-streaming)
     */
    generate(input: string | Message[], context?: Record<string, unknown>): Promise<AgentResponse>;
    /**
     * Stream a response
     * Returns a ReadableStream compatible with Vercel AI SDK Data Stream Protocol
     */
    stream(messages: Message[], context?: Record<string, unknown>, callbacks?: {
        onToolCall?: (toolCall: ToolCall) => void;
        onChunk?: (chunk: string) => void;
    }): Promise<ReadableStream<Uint8Array>>;
    /**
     * Execute agent loop (with tool calling)
     */
    private executeAgentLoop;
    /**
     * Execute agent loop with streaming
     * Uses Vercel AI SDK UI Message Stream Protocol v5 format
     */
    private executeAgentLoopStreaming;
    /**
     * Record a tool error and send SSE event.
     */
    private recordToolError;
    /**
     * Resolve system prompt (handle string or function)
     */
    private resolveSystemPrompt;
    /**
     * Compute max steps considering edge config and platform limits.
     */
    private computeMaxSteps;
    /**
     * Get memory instance (for advanced use cases)
     */
    getMemory(): Memory<Message>;
    /**
     * Get memory stats
     */
    getMemoryStats(): Promise<{
        totalMessages: number;
        estimatedTokens: number;
        type: string;
    }>;
    /**
     * Clear agent memory
     */
    clearMemory(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map