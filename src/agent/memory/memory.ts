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
interface MemoryRollback<M extends MinimalMessage = MinimalMessage> {
  commit(): void;
  rollback(rejectedMessages?: ReadonlySet<M>): Promise<void>;
}
interface RollbackObserver<M> {
  add(message: M): void;
  clear(): void;
}
const memoryRollbackFactories = new WeakMap<object, () => MemoryRollback>();

function registerMemoryRollbackFactory<M extends MinimalMessage>(
  memory: Memory<M>,
  factory: () => MemoryRollback,
): void {
  memoryRollbackFactories.set(memory, factory);
}

/** @internal Capture an exact built-in memory state before a transactional write. */
export function captureMemoryRollback<M extends MinimalMessage>(
  memory: Memory<M>,
  fallbackMessages: readonly M[],
): MemoryRollback {
  const factory = memoryRollbackFactories.get(memory);
  if (factory) return factory();

  // Preserve compatibility with custom Memory implementations. Built-in
  // stores use exact private-state snapshots registered in their constructors.
  const snapshot = [...fallbackMessages];
  return {
    commit() {},
    async rollback(rejectedMessages) {
      const current = await memory.getMessages();
      const snapshotMessages = new Set(snapshot);
      const laterMessages = rejectedMessages === undefined
        ? []
        : current.filter((message) =>
          !snapshotMessages.has(message) && !rejectedMessages.has(message)
        );
      await memory.clear();
      for (const message of snapshot) await memory.add(message);
      for (const message of laterMessages) await memory.add(message);
    },
  };
}

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
  private rollbackObservers = new Set<RollbackObserver<M>>();
  private clearVersion = 0;
  protected abstract readonly memoryType: BasicMemoryType;
  protected abstract readonly spanPrefix: string;

  constructor() {
    registerMemoryRollbackFactory(this, () => {
      const messages = [...this.messages];
      const snapshotMessages = new Set(messages);
      const clearVersion = this.clearVersion;
      const additions: M[] = [];
      const observe: RollbackObserver<M> = {
        add: (message) => additions.push(message),
        clear: () => {
          additions.length = 0;
        },
      };
      this.rollbackObservers.add(observe);
      let active = true;
      const close = () => {
        if (!active) return;
        active = false;
        this.rollbackObservers.delete(observe);
      };
      return {
        commit: close,
        rollback: async (rejectedMessages) => {
          close();
          if (this.clearVersion !== clearVersion) {
            const replayVersion = this.clearVersion;
            const retained = rejectedMessages === undefined
              ? additions
              : additions.filter((message) => !rejectedMessages.has(message));
            this.messages = [];
            for (const message of retained) {
              if (this.clearVersion !== replayVersion) return;
              await this.add(message);
              if (this.clearVersion !== replayVersion) return;
            }
            return;
          }
          const laterAdditions = rejectedMessages === undefined
            ? []
            : additions.filter((message) =>
              !snapshotMessages.has(message) && !rejectedMessages.has(message)
            );
          this.messages = [...messages];
          for (const message of laterAdditions) {
            if (this.clearVersion !== clearVersion) return;
            await this.add(message);
            if (this.clearVersion !== clearVersion) return;
          }
        },
      };
    });
  }

  abstract add(message: M): Promise<void>;

  protected recordAddition(message: M): void {
    for (const observe of this.rollbackObservers) observe.add(message);
  }

  getMessages(): Promise<M[]> {
    return getMessagesWithTrace(this.messages, `${this.spanPrefix}.getMessages`, this.memoryType);
  }

  clear(): Promise<void> {
    return clearMessagesWithTrace(
      () => {
        this.messages = [];
        this.clearVersion += 1;
        for (const observe of this.rollbackObservers) observe.clear();
      },
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
        this.recordAddition(message);
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
          this.recordAddition(message);
        },
        { "memory.type": "buffer", "memory.buffer_size": this.bufferSize },
      ),
    );
  }
}

const DEFAULT_SUMMARY_MAX_CHARS = 4_000;
const SUMMARY_OMISSION_MARKER = "; [...]; ";
const SUMMARY_MESSAGE_PREFIX = "Previous conversation summary:\n";
const summaryMemoryProjectionMessages = new WeakSet<object>();
const summaryProjectionWeakSetAdd = WeakSet.prototype.add;
const summaryProjectionWeakSetHas = WeakSet.prototype.has;
const summaryProjectionReflectApply = Reflect.apply;

/** Whether this message is the provider projection synthesized by summary memory. */
export function isSummaryMemoryProjectionMessage(message: unknown): boolean {
  return typeof message === "object" && message !== null &&
    summaryProjectionReflectApply(
      summaryProjectionWeakSetHas,
      summaryMemoryProjectionMessages,
      [message],
    ) as boolean;
}

/** Implement summary memory. */
export class SummaryMemory<M extends MinimalMessage = MinimalMessage> implements Memory<M> {
  private messages: M[] = [];
  private rollbackObservers = new Set<RollbackObserver<M>>();
  private summary = "";
  private summaryThreshold: number;
  private summaryMaxChars: number;
  private maxTokens?: number;
  private clearVersion = 0;

  constructor(private config: MemoryConfigBase) {
    this.summaryThreshold = config.maxMessages || 20;
    this.maxTokens = config.maxTokens;
    this.summaryMaxChars = Math.max(
      1,
      Math.min(DEFAULT_SUMMARY_MAX_CHARS, Math.floor((config.maxTokens ?? 1_000) * 4)),
    );
    registerMemoryRollbackFactory(this, () => {
      const messages = [...this.messages];
      const snapshotMessages = new Set(messages);
      const summary = this.summary;
      const clearVersion = this.clearVersion;
      const additions: M[] = [];
      const observe: RollbackObserver<M> = {
        add: (message) => additions.push(message),
        clear: () => {
          additions.length = 0;
        },
      };
      this.rollbackObservers.add(observe);
      let active = true;
      const close = () => {
        if (!active) return;
        active = false;
        this.rollbackObservers.delete(observe);
      };
      return {
        commit: close,
        rollback: async (rejectedMessages) => {
          close();
          if (this.clearVersion !== clearVersion) {
            const replayVersion = this.clearVersion;
            const retained = rejectedMessages === undefined
              ? additions
              : additions.filter((message) => !rejectedMessages.has(message));
            this.messages = [];
            this.summary = "";
            for (const message of retained) {
              if (this.clearVersion !== replayVersion) return;
              await this.add(message);
              if (this.clearVersion !== replayVersion) return;
            }
            return;
          }
          const laterAdditions = rejectedMessages === undefined
            ? []
            : additions.filter((message) =>
              !snapshotMessages.has(message) && !rejectedMessages.has(message)
            );
          this.messages = [...messages];
          this.summary = summary;
          for (const message of laterAdditions) {
            if (this.clearVersion !== clearVersion) return;
            await this.add(message);
            if (this.clearVersion !== clearVersion) return;
          }
        },
      };
    });
  }

  add(message: M): Promise<void> {
    return withSpan(
      "agent.memory.summary.add",
      async () => {
        this.messages.push(message);

        if (this.messages.length > this.summaryThreshold) {
          await this.summarizeOldMessages();
        }

        this.enforceTokenLimit();
        for (const observe of this.rollbackObservers) observe.add(message);
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

          const summaryParts = [
            {
              type: "text",
              text: `${SUMMARY_MESSAGE_PREFIX}${this.summary}`,
            },
          ];
          const summaryMessage: MinimalMessage = {
            id: "summary",
            role: "system",
            parts: summaryParts,
            timestamp: Date.now(),
          };
          summaryProjectionReflectApply(
            summaryProjectionWeakSetAdd,
            summaryMemoryProjectionMessages,
            [summaryMessage],
          );

          return [summaryMessage as M, ...this.messages];
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
          this.clearVersion += 1;
          for (const observe of this.rollbackObservers) observe.clear();
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

        return {
          totalMessages: allMessages.length,
          estimatedTokens: estimateTokens(allMessages),
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

    this.appendToSummary(toSummarize);
    this.messages = remaining;

    return Promise.resolve();
  }

  private appendToSummary(messages: M[]): void {
    const topics = messages
      .filter((m) => m.role === "user")
      .map((m) => getTextFromMemoryParts(m.parts as Array<{ type: string; text?: string }>))
      .map((text) => text.substring(0, 50))
      .join("; ");

    const newSummary = `Discussed: ${topics}`;
    const combinedSummary = this.summary ? `${this.summary}; ${newSummary}` : newSummary;
    this.summary = this.boundSummary(combinedSummary);
  }

  private enforceTokenLimit(): void {
    if (!this.maxTokens) return;

    const maxChars = this.maxTokens * 4;
    while (this.messages.length > 1 && this.totalTextChars() > maxChars) {
      const oldest = this.messages.shift();
      if (oldest) this.appendToSummary([oldest]);
    }

    if (!this.summary) return;

    const tailChars = this.messages.reduce(
      (total, message) =>
        total +
        getTextFromMemoryParts(message.parts as Array<{ type: string; text?: string }>).length,
      0,
    );
    const availableSummaryChars = maxChars - tailChars - SUMMARY_MESSAGE_PREFIX.length;
    if (availableSummaryChars <= 0) {
      this.summary = "";
      return;
    }

    this.summary = this.boundSummary(this.summary, availableSummaryChars);
  }

  private totalTextChars(): number {
    const tailChars = this.messages.reduce(
      (total, message) =>
        total +
        getTextFromMemoryParts(message.parts as Array<{ type: string; text?: string }>).length,
      0,
    );
    return tailChars + (this.summary ? SUMMARY_MESSAGE_PREFIX.length + this.summary.length : 0);
  }

  private boundSummary(summary: string, maxChars = this.summaryMaxChars): string {
    const boundedMaxChars = Math.min(this.summaryMaxChars, Math.max(0, Math.floor(maxChars)));
    if (boundedMaxChars === 0) return "";
    if (summary.length <= boundedMaxChars) return summary;
    if (boundedMaxChars <= SUMMARY_OMISSION_MARKER.length) {
      return summary.slice(-boundedMaxChars);
    }

    const contentBudget = boundedMaxChars - SUMMARY_OMISSION_MARKER.length;
    const headLength = Math.ceil(contentBudget / 2);
    const tailLength = contentBudget - headLength;
    const tail = tailLength > 0 ? summary.slice(-tailLength) : "";
    return summary.slice(0, headLength) + SUMMARY_OMISSION_MARKER + tail;
  }
}

/**
 * No-op memory.
 *
 * Holds nothing and never persists. Used when an agent has no `memory` config
 * (the documented stateless default) or when `memory.enabled === false`. Every
 * `stream()` / `generate()` call then runs in isolation on just its own input,
 * which is what makes concurrent fan-out on a shared agent instance safe: runs
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
