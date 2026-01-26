/****
 * Agent Memory System
 *
 * Manages conversation history with different strategies:
 * - Conversation: Keep all messages
 * - Buffer: Keep last N messages
 * - Summary: Summarize old messages to save tokens
 */
import { estimateTokens, getTextFromMemoryParts, } from "./memory-interface.js";
import { withSpan, withSpanSync } from "../../observability/tracing/otlp-setup.js";
// Re-export from interface for backwards compatibility
export { estimateTokens, };
/**
 * Conversation Memory - Keeps all messages
 */
export class ConversationMemory {
    messages = [];
    config;
    constructor(config) {
        this.config = config;
    }
    add(message) {
        return withSpan("agent.memory.conversation.add", async () => {
            this.messages.push(message);
            if (this.config.maxMessages && this.messages.length > this.config.maxMessages) {
                this.messages = this.messages.slice(-this.config.maxMessages);
            }
            if (this.config.maxTokens) {
                await this.trimToTokenLimit();
            }
        }, { "memory.type": "conversation", "memory.message_count": this.messages.length });
    }
    getMessages() {
        return Promise.resolve(withSpanSync("agent.memory.conversation.getMessages", () => [...this.messages], { "memory.type": "conversation", "memory.message_count": this.messages.length }));
    }
    clear() {
        return Promise.resolve(withSpanSync("agent.memory.conversation.clear", () => {
            this.messages = [];
        }, { "memory.type": "conversation" }));
    }
    getStats() {
        return Promise.resolve(withSpanSync("agent.memory.conversation.getStats", () => ({
            totalMessages: this.messages.length,
            estimatedTokens: estimateTokens(this.messages),
            type: "conversation",
        }), { "memory.type": "conversation" }));
    }
    trimToTokenLimit() {
        const maxTokens = this.config.maxTokens;
        if (!maxTokens)
            return Promise.resolve();
        let tokenCount = estimateTokens(this.messages);
        while (tokenCount > maxTokens && this.messages.length > 1) {
            this.messages.shift();
            tokenCount = estimateTokens(this.messages);
        }
        return Promise.resolve();
    }
}
/**
 * Buffer Memory - Keeps last N messages
 */
export class BufferMemory {
    messages = [];
    config;
    bufferSize;
    constructor(config) {
        this.config = config;
        this.bufferSize = config.maxMessages || 10;
    }
    add(message) {
        return Promise.resolve(withSpanSync("agent.memory.buffer.add", () => {
            this.messages.push(message);
            if (this.messages.length > this.bufferSize) {
                this.messages = this.messages.slice(-this.bufferSize);
            }
        }, { "memory.type": "buffer", "memory.buffer_size": this.bufferSize }));
    }
    getMessages() {
        return Promise.resolve(withSpanSync("agent.memory.buffer.getMessages", () => [...this.messages], { "memory.type": "buffer", "memory.message_count": this.messages.length }));
    }
    clear() {
        return Promise.resolve(withSpanSync("agent.memory.buffer.clear", () => {
            this.messages = [];
        }, { "memory.type": "buffer" }));
    }
    getStats() {
        return Promise.resolve(withSpanSync("agent.memory.buffer.getStats", () => ({
            totalMessages: this.messages.length,
            estimatedTokens: estimateTokens(this.messages),
            type: "buffer",
        }), { "memory.type": "buffer" }));
    }
}
/**
 * Summary Memory - Summarizes old messages
 * (Simplified version - full implementation would use LLM for summarization)
 */
export class SummaryMemory {
    messages = [];
    summary = "";
    config;
    summaryThreshold;
    constructor(config) {
        this.config = config;
        this.summaryThreshold = config.maxMessages || 20;
    }
    add(message) {
        return withSpan("agent.memory.summary.add", async () => {
            this.messages.push(message);
            if (this.messages.length > this.summaryThreshold) {
                await this.summarizeOldMessages();
            }
        }, { "memory.type": "summary", "memory.threshold": this.summaryThreshold });
    }
    getMessages() {
        return Promise.resolve(withSpanSync("agent.memory.summary.getMessages", () => {
            if (!this.summary)
                return [...this.messages];
            const summaryMessage = {
                id: "summary",
                role: "system",
                parts: [
                    {
                        type: "text",
                        text: `Previous conversation summary:\n${this.summary}`,
                    },
                ],
                timestamp: Date.now(),
            };
            return [summaryMessage, ...this.messages];
        }, { "memory.type": "summary", "memory.has_summary": !!this.summary }));
    }
    clear() {
        return Promise.resolve(withSpanSync("agent.memory.summary.clear", () => {
            this.messages = [];
            this.summary = "";
        }, { "memory.type": "summary" }));
    }
    getStats() {
        return withSpan("agent.memory.summary.getStats", async () => {
            const allMessages = await this.getMessages();
            const baseTokens = estimateTokens(allMessages);
            const summaryTokens = Math.ceil(this.summary.length / 4);
            return {
                totalMessages: allMessages.length,
                estimatedTokens: baseTokens + summaryTokens,
                type: "summary",
            };
        }, { "memory.type": "summary" });
    }
    summarizeOldMessages() {
        const halfIndex = Math.floor(this.messages.length / 2);
        const toSummarize = this.messages.slice(0, halfIndex);
        const remaining = this.messages.slice(halfIndex);
        const topics = toSummarize
            .filter((m) => m.role === "user")
            .map((m) => getTextFromMemoryParts(m.parts).substring(0, 50))
            .join("; ");
        this.summary = `Discussed: ${topics}`;
        this.messages = remaining;
        return Promise.resolve();
    }
}
/**
 * Create memory instance based on config
 */
export function createMemory(config) {
    switch (config.type) {
        case "buffer":
            return new BufferMemory(config);
        case "summary":
            return new SummaryMemory(config);
        case "conversation":
        default:
            return new ConversationMemory(config);
    }
}
