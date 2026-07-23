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
  /** Memory implementation identifier. */
  type: string;
  /** Optional token capacity. */
  maxTokens?: number;
  /** Optional message capacity. */
  maxMessages?: number;
  /**
   * Persist conversation history across `stream()` / `generate()` calls on the
   * agent instance. Defaults to `true` when a memory config is provided. Set to
   * `false` to run every call in isolation (no shared history), the same
   * effect as omitting `memory` entirely.
   */
  enabled?: boolean;
}

/** Public API contract for memory stats. */
export interface MemoryStats {
  /** Total messages value. */
  totalMessages: number;
  /** Estimated tokens value. */
  estimatedTokens: number;
  /** Discriminator for this value. */
  type: string;
}

/** Minimal message contract required by memory implementations. */
export interface MinimalMessage {
  /** Message identifier. */
  id: string;
  /** Message author role. */
  role: "user" | "assistant" | "system" | "tool";
  /** Ordered message parts. */
  parts: Array<{ type: string }>;
  /** Optional numeric timestamp. */
  timestamp?: number;
  /** Optional message metadata. */
  metadata?: Record<string, unknown>;
}

/** Public API contract for memory. */
export interface Memory<M extends MinimalMessage = MinimalMessage> {
  /** Adds a message to memory. */
  add(message: M): Promise<void>;
  /** Returns messages. */
  getMessages(): Promise<M[]>;
  /** Clears stored conversation state. */
  clear(): Promise<void>;
  /** Returns stats. */
  getStats(): Promise<MemoryStats>;
}

/** Public API contract for memory persistence. */
export interface MemoryPersistence<M extends MinimalMessage = MinimalMessage> {
  /** Performs the save operation. */
  save(agentId: string, messages: M[]): Promise<void>;
  /** Performs the load operation. */
  load(agentId: string): Promise<M[]>;
  /** Clears stored conversation state. */
  clear(agentId: string): Promise<void>;
}

export function getTextFromMemoryParts(
  parts: Array<{ type: string; text?: string }>,
): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("");
}

export function estimateTokens(messages: MinimalMessage[]): number {
  const totalChars = messages.reduce((sum, msg) => {
    const text = getTextFromMemoryParts(
      msg.parts as Array<{ type: string; text?: string }>,
    );
    return sum + text.length;
  }, 0);

  return Math.ceil(totalChars / 4);
}
