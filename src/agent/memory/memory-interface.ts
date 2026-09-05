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
  totalMessages: number;
  estimatedTokens: number;
  type: string;
}

export interface MinimalMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  parts: Array<{ type: string }>;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

/** Public API contract for memory. */
export interface Memory<M extends MinimalMessage = MinimalMessage> {
  add(message: M): Promise<void>;
  getMessages(): Promise<M[]>;
  clear(): Promise<void>;
  getStats(): Promise<MemoryStats>;
  /**
   * Capture a backend-owned rollback boundary before validated input writes.
   * Required for custom stores used with transactional input validation.
   */
  beginInputTransaction?(): MemoryInputTransaction<M> | Promise<MemoryInputTransaction<M>>;
}

/**
 * Backend-owned transaction for writes made through the memory instance.
 * Rollback must atomically remove rejected writes and restore any displaced
 * history without undoing concurrent additions or resurrecting cleared data.
 * Both operations must be idempotent. Commit releases rollback resources.
 */
export interface MemoryInputTransaction<M extends MinimalMessage = MinimalMessage> {
  commit(): void | Promise<void>;
  rollback(rejectedMessages?: ReadonlySet<M>): Promise<void>;
}

/** Public API contract for memory persistence. */
export interface MemoryPersistence<M extends MinimalMessage = MinimalMessage> {
  save(agentId: string, messages: M[]): Promise<void>;
  load(agentId: string): Promise<M[]>;
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
