/**
 * Agent Memory System
 *
 * Manages conversation history with different strategies:
 * - Conversation: Keep all messages
 * - Buffer: Keep last N messages
 * - Summary: Summarize old messages to save tokens
 */

import {
  estimateTokens,
  getTextFromMemoryParts,
  type Memory,
  type MemoryConfigBase,
  type MemoryPersistence,
  type MemoryStats,
  type MinimalMessage,
} from "./memory-interface.ts";
import { withSpan, withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";

// Re-export from interface for backwards compatibility
export {
  estimateTokens,
  type Memory,
  type MemoryPersistence,
  type MemoryStats,
  type MinimalMessage,
};

/**
 * Conversation Memory - Keeps all messages
 */
export class ConversationMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private messages: M[] = [];
  private config: MemoryConfigBase;

  constructor(config: MemoryConfigBase) {
    this.config = config;
  }

  add(message: M): Promise<void> {
    return withSpan("agent.memory.conversation.add", async () => {
      this.messages.push(message);

      // Trim if max messages exceeded
      if (
        this.config.maxMessages &&
        this.messages.length > this.config.maxMessages
      ) {
        this.messages = this.messages.slice(-this.config.maxMessages);
      }

      // Trim if max tokens exceeded
      if (this.config.maxTokens) {
        await this.trimToTokenLimit();
      }
    }, { "memory.type": "conversation", "memory.message_count": this.messages.length });
  }

  getMessages(): Promise<M[]> {
    return Promise.resolve(withSpanSync("agent.memory.conversation.getMessages", () => {
      return [...this.messages];
    }, { "memory.type": "conversation", "memory.message_count": this.messages.length }));
  }

  clear(): Promise<void> {
    return Promise.resolve(withSpanSync("agent.memory.conversation.clear", () => {
      this.messages = [];
    }, { "memory.type": "conversation" }));
  }

  getStats(): Promise<MemoryStats> {
    return Promise.resolve(withSpanSync("agent.memory.conversation.getStats", () => {
      return {
        totalMessages: this.messages.length,
        estimatedTokens: estimateTokens(this.messages),
        type: "conversation",
      };
    }, { "memory.type": "conversation" }));
  }

  private trimToTokenLimit(): Promise<void> {
    if (!this.config.maxTokens) return Promise.resolve();

    let tokenCount = estimateTokens(this.messages);

    // Remove oldest messages until under limit
    while (
      tokenCount > this.config.maxTokens &&
      this.messages.length > 1
    ) {
      this.messages.shift();
      tokenCount = estimateTokens(this.messages);
    }
    return Promise.resolve();
  }
}

/**
 * Buffer Memory - Keeps last N messages
 */
export class BufferMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private messages: M[] = [];
  private config: MemoryConfigBase;
  private bufferSize: number;

  constructor(config: MemoryConfigBase) {
    this.config = config;
    this.bufferSize = config.maxMessages || 10;
  }

  add(message: M): Promise<void> {
    return Promise.resolve(withSpanSync("agent.memory.buffer.add", () => {
      this.messages.push(message);

      // Keep only last N messages
      if (this.messages.length > this.bufferSize) {
        this.messages = this.messages.slice(-this.bufferSize);
      }
    }, { "memory.type": "buffer", "memory.buffer_size": this.bufferSize }));
  }

  getMessages(): Promise<M[]> {
    return Promise.resolve(withSpanSync("agent.memory.buffer.getMessages", () => {
      return [...this.messages];
    }, { "memory.type": "buffer", "memory.message_count": this.messages.length }));
  }

  clear(): Promise<void> {
    return Promise.resolve(withSpanSync("agent.memory.buffer.clear", () => {
      this.messages = [];
    }, { "memory.type": "buffer" }));
  }

  getStats(): Promise<MemoryStats> {
    return Promise.resolve(withSpanSync("agent.memory.buffer.getStats", () => {
      return {
        totalMessages: this.messages.length,
        estimatedTokens: estimateTokens(this.messages),
        type: "buffer",
      };
    }, { "memory.type": "buffer" }));
  }
}

/**
 * Summary Memory - Summarizes old messages
 * (Simplified version - full implementation would use LLM for summarization)
 */
export class SummaryMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private messages: M[] = [];
  private summary: string = "";
  private config: MemoryConfigBase;
  private summaryThreshold: number;

  constructor(config: MemoryConfigBase) {
    this.config = config;
    this.summaryThreshold = config.maxMessages || 20;
  }

  add(message: M): Promise<void> {
    return withSpan("agent.memory.summary.add", async () => {
      this.messages.push(message);

      // Summarize if threshold exceeded
      if (this.messages.length > this.summaryThreshold) {
        await this.summarizeOldMessages();
      }
    }, { "memory.type": "summary", "memory.threshold": this.summaryThreshold });
  }

  getMessages(): Promise<M[]> {
    return Promise.resolve(withSpanSync("agent.memory.summary.getMessages", () => {
      // If we have a summary, include it as first message
      if (this.summary) {
        // Create a summary message that conforms to M
        // Note: This cast is necessary because we're creating a new message
        const summaryMessage = {
          id: "summary",
          role: "system" as const,
          parts: [{
            type: "text" as const,
            text: `Previous conversation summary:\n${this.summary}`,
          }],
          timestamp: Date.now(),
        } as unknown as M;

        return [summaryMessage, ...this.messages];
      }

      return [...this.messages];
    }, { "memory.type": "summary", "memory.has_summary": !!this.summary }));
  }

  clear(): Promise<void> {
    return Promise.resolve(withSpanSync("agent.memory.summary.clear", () => {
      this.messages = [];
      this.summary = "";
    }, { "memory.type": "summary" }));
  }

  getStats(): Promise<MemoryStats> {
    return withSpan("agent.memory.summary.getStats", async () => {
      const allMessages = await this.getMessages();
      // Add summary length to token estimate
      const baseTokens = estimateTokens(allMessages);
      const summaryTokens = Math.ceil(this.summary.length / 4);
      return {
        totalMessages: allMessages.length,
        estimatedTokens: baseTokens + summaryTokens,
        type: "summary",
      };
    }, { "memory.type": "summary" });
  }

  private summarizeOldMessages(): Promise<void> {
    // Take first half of messages for summarization
    const halfIndex = Math.floor(this.messages.length / 2);
    const toSummarize = this.messages.slice(0, halfIndex);
    const remaining = this.messages.slice(halfIndex);

    // Simple summarization (in production, use LLM)
    const topics = toSummarize
      .filter((m) => m.role === "user")
      .map((m) =>
        getTextFromMemoryParts(m.parts as Array<{ type: string; text?: string }>).substring(0, 50)
      )
      .join("; ");

    this.summary = `Discussed: ${topics}`;
    this.messages = remaining;
    return Promise.resolve();
  }
}

/**
 * Create memory instance based on config
 */
export function createMemory<M extends MinimalMessage = MinimalMessage>(
  config: MemoryConfigBase,
): Memory<M> {
  switch (config.type) {
    case "buffer":
      return new BufferMemory<M>(config);
    case "summary":
      return new SummaryMemory<M>(config);
    case "conversation":
    default:
      return new ConversationMemory<M>(config);
  }
}
