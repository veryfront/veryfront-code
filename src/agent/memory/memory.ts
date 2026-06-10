import {
  estimateTokens,
  getTextFromMemoryParts,
  type Memory,
  type MemoryConfigBase,
  type MemoryStats,
  type MinimalMessage,
} from "./memory-interface.ts";
import { withSpan, withSpanSync } from "#veryfront/observability/tracing/otlp-setup.ts";

type BasicMemoryType = "conversation" | "buffer";

function getMessagesWithTrace<M extends MinimalMessage>(
  messages: M[],
  spanName: string,
  memoryType: BasicMemoryType,
): Promise<M[]> {
  return Promise.resolve(
    withSpanSync(
      spanName,
      () => [...messages],
      { "memory.type": memoryType, "memory.message_count": messages.length },
    ),
  );
}

function clearMessagesWithTrace(
  clearMessages: () => void,
  spanName: string,
  memoryType: BasicMemoryType,
): Promise<void> {
  return Promise.resolve(
    withSpanSync(
      spanName,
      clearMessages,
      { "memory.type": memoryType },
    ),
  );
}

function getBasicStatsWithTrace<M extends MinimalMessage>(
  messages: M[],
  spanName: string,
  memoryType: BasicMemoryType,
): Promise<MemoryStats> {
  return Promise.resolve(
    withSpanSync(
      spanName,
      () => ({
        totalMessages: messages.length,
        estimatedTokens: estimateTokens(messages),
        type: memoryType,
      }),
      { "memory.type": memoryType },
    ),
  );
}

abstract class BasicMemoryStore<M extends MinimalMessage> implements Memory<M> {
  protected messages: M[] = [];
  protected abstract readonly memoryType: BasicMemoryType;
  protected abstract readonly spanPrefix: string;

  abstract add(message: M): Promise<void>;

  getMessages(): Promise<M[]> {
    return getMessagesWithTrace(this.messages, `${this.spanPrefix}.getMessages`, this.memoryType);
  }

  clear(): Promise<void> {
    return clearMessagesWithTrace(
      () => (this.messages = []),
      `${this.spanPrefix}.clear`,
      this.memoryType,
    );
  }

  getStats(): Promise<MemoryStats> {
    return getBasicStatsWithTrace(this.messages, `${this.spanPrefix}.getStats`, this.memoryType);
  }
}

/** Implement conversation memory. */
export class ConversationMemory<M extends MinimalMessage = MinimalMessage>
  extends BasicMemoryStore<M> {
  protected readonly memoryType = "conversation" as const;
  protected readonly spanPrefix = "agent.memory.conversation";

  constructor(private config: MemoryConfigBase) {
    super();
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.conversation.add",
      async () => {
        this.messages.push(message);

        const maxMessages = this.config.maxMessages;
        if (maxMessages && this.messages.length > maxMessages) {
          this.messages = this.messages.slice(-maxMessages);
        }

        if (this.config.maxTokens) {
          await this.trimToTokenLimit();
        }
      },
      { "memory.type": "conversation", "memory.message_count": this.messages.length },
    );
  }

  private trimToTokenLimit(): Promise<void> {
    const maxTokens = this.config.maxTokens;
    if (!maxTokens) return Promise.resolve();

    let tokenCount = estimateTokens(this.messages);

    while (tokenCount > maxTokens && this.messages.length > 1) {
      this.messages.shift();
      tokenCount = estimateTokens(this.messages);
    }

    return Promise.resolve();
  }
}

/** Implement buffer memory. */
export class BufferMemory<M extends MinimalMessage = MinimalMessage> extends BasicMemoryStore<M> {
  protected readonly memoryType = "buffer" as const;
  protected readonly spanPrefix = "agent.memory.buffer";
  private bufferSize: number;

  constructor(config: MemoryConfigBase) {
    super();
    this.bufferSize = config.maxMessages || 10;
  }

  add(message: M): Promise<void> {
    return Promise.resolve(
      withSpanSync(
        "agent.memory.buffer.add",
        () => {
          this.messages.push(message);

          if (this.messages.length > this.bufferSize) {
            this.messages = this.messages.slice(-this.bufferSize);
          }
        },
        { "memory.type": "buffer", "memory.buffer_size": this.bufferSize },
      ),
    );
  }
}

/** Implement summary memory. */
export class SummaryMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private messages: M[] = [];
  private summary = "";
  private summaryThreshold: number;

  constructor(private config: MemoryConfigBase) {
    this.summaryThreshold = config.maxMessages || 20;
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.summary.add",
      async () => {
        this.messages.push(message);

        if (this.messages.length > this.summaryThreshold) {
          await this.summarizeOldMessages();
        }
      },
      { "memory.type": "summary", "memory.threshold": this.summaryThreshold },
    );
  }

  getMessages(): Promise<M[]> {
    return Promise.resolve(
      withSpanSync(
        "agent.memory.summary.getMessages",
        () => {
          if (!this.summary) return [...this.messages];

          const summaryMessage = {
            id: "summary",
            role: "system" as const,
            parts: [
              {
                type: "text" as const,
                text: `Previous conversation summary:\n${this.summary}`,
              },
            ],
            timestamp: Date.now(),
          } as unknown as M;

          return [summaryMessage, ...this.messages];
        },
        { "memory.type": "summary", "memory.has_summary": !!this.summary },
      ),
    );
  }

  clear(): Promise<void> {
    return Promise.resolve(
      withSpanSync(
        "agent.memory.summary.clear",
        () => {
          this.messages = [];
          this.summary = "";
        },
        { "memory.type": "summary" },
      ),
    );
  }

  getStats(): Promise<MemoryStats> {
    return withSpan(
      "agent.memory.summary.getStats",
      async () => {
        const allMessages = await this.getMessages();
        const baseTokens = estimateTokens(allMessages);
        const summaryTokens = Math.ceil(this.summary.length / 4);

        return {
          totalMessages: allMessages.length,
          estimatedTokens: baseTokens + summaryTokens,
          type: "summary",
        };
      },
      { "memory.type": "summary" },
    );
  }

  private summarizeOldMessages(): Promise<void> {
    const halfIndex = Math.floor(this.messages.length / 2);
    const toSummarize = this.messages.slice(0, halfIndex);
    const remaining = this.messages.slice(halfIndex);

    const topics = toSummarize
      .filter((m) => m.role === "user")
      .map((m) => getTextFromMemoryParts(m.parts as Array<{ type: string; text?: string }>))
      .map((text) => text.substring(0, 50))
      .join("; ");

    this.summary = `Discussed: ${topics}`;
    this.messages = remaining;

    return Promise.resolve();
  }
}

/**
 * No-op memory.
 *
 * Holds nothing and never persists. Used when an agent has no `memory` config
 * (the documented stateless default) or when `memory.enabled === false`. Every
 * `stream()` / `generate()` call then runs in isolation on just its own input,
 * which is what makes concurrent fan-out on a shared agent instance safe — runs
 * cannot interleave into a shared conversation. Multi-step tool loops are
 * unaffected: in-run continuity is driven by the loop's local message array,
 * not by this store.
 */
export class NoMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  add(_message: M): Promise<void> {
    return Promise.resolve();
  }

  getMessages(): Promise<M[]> {
    return Promise.resolve([]);
  }

  clear(): Promise<void> {
    return Promise.resolve();
  }

  getStats(): Promise<MemoryStats> {
    return Promise.resolve({ totalMessages: 0, estimatedTokens: 0, type: "none" });
  }
}

/** Create memory. */
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

/**
 * Resolve the memory store for an agent runtime.
 *
 * Agents are stateless by default: with no `memory` config (or `enabled: false`)
 * the runtime gets a {@link NoMemory} store so calls never share conversation
 * history. A provided config opts in to cross-call persistence.
 */
export function createAgentMemory<M extends MinimalMessage = MinimalMessage>(
  config?: MemoryConfigBase,
): Memory<M> {
  if (!config || config.enabled === false) {
    return new NoMemory<M>();
  }
  return createMemory<M>(config);
}
