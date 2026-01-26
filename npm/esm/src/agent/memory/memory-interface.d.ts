/**************************
 * Memory Interface
 *
 * Core memory abstractions extracted to avoid circular dependencies.
 * This file should NOT import from ../types.ts
 *
 * The Memory interface uses generic type parameters to work with
 * any message type, allowing implementations to be type-safe while
 * avoiding circular dependencies with the main types module.
 **************************/
export interface MemoryConfigBase {
    type: string;
    maxTokens?: number;
    maxMessages?: number;
}
export interface MemoryStats {
    totalMessages: number;
    estimatedTokens: number;
    type: string;
}
export interface MinimalMessage {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    parts: Array<{
        type: string;
    }>;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}
export interface Memory<M extends MinimalMessage = MinimalMessage> {
    add(message: M): Promise<void>;
    getMessages(): Promise<M[]>;
    clear(): Promise<void>;
    getStats(): Promise<MemoryStats>;
}
export interface MemoryPersistence<M extends MinimalMessage = MinimalMessage> {
    save(agentId: string, messages: M[]): Promise<void>;
    load(agentId: string): Promise<M[]>;
    clear(agentId: string): Promise<void>;
}
export declare function getTextFromMemoryParts(parts: Array<{
    type: string;
    text?: string;
}>): string;
export declare function estimateTokens(messages: MinimalMessage[]): number;
//# sourceMappingURL=memory-interface.d.ts.map