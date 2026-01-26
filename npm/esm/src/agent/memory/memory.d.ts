/****
 * Agent Memory System
 *
 * Manages conversation history with different strategies:
 * - Conversation: Keep all messages
 * - Buffer: Keep last N messages
 * - Summary: Summarize old messages to save tokens
 */
import { estimateTokens, type Memory, type MemoryConfigBase, type MemoryPersistence, type MemoryStats, type MinimalMessage } from "./memory-interface.js";
export { estimateTokens, type Memory, type MemoryPersistence, type MemoryStats, type MinimalMessage, };
/**
 * Conversation Memory - Keeps all messages
 */
export declare class ConversationMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
    private messages;
    private config;
    constructor(config: MemoryConfigBase);
    add(message: M): Promise<void>;
    getMessages(): Promise<M[]>;
    clear(): Promise<void>;
    getStats(): Promise<MemoryStats>;
    private trimToTokenLimit;
}
/**
 * Buffer Memory - Keeps last N messages
 */
export declare class BufferMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
    private messages;
    private config;
    private bufferSize;
    constructor(config: MemoryConfigBase);
    add(message: M): Promise<void>;
    getMessages(): Promise<M[]>;
    clear(): Promise<void>;
    getStats(): Promise<MemoryStats>;
}
/**
 * Summary Memory - Summarizes old messages
 * (Simplified version - full implementation would use LLM for summarization)
 */
export declare class SummaryMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
    private messages;
    private summary;
    private config;
    private summaryThreshold;
    constructor(config: MemoryConfigBase);
    add(message: M): Promise<void>;
    getMessages(): Promise<M[]>;
    clear(): Promise<void>;
    getStats(): Promise<MemoryStats>;
    private summarizeOldMessages;
}
/**
 * Create memory instance based on config
 */
export declare function createMemory<M extends MinimalMessage = MinimalMessage>(config: MemoryConfigBase): Memory<M>;
//# sourceMappingURL=memory.d.ts.map