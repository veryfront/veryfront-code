/**
 * Memory Interface
 *
 * Core memory abstractions extracted to avoid circular dependencies.
 * This file should NOT import from ../types.ts
 *
 * The Memory interface uses generic type parameters to work with
 * any message type, allowing implementations to be type-safe while
 * avoiding circular dependencies with the main types module.
 */

/**
 * Memory configuration - minimal interface for memory implementations
 */
export interface MemoryConfigBase {
  /** Memory type */
  type: string;

  /** Maximum tokens to store in memory */
  maxTokens?: number;

  /** Maximum messages to store */
  maxMessages?: number;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  /** Total messages stored */
  totalMessages: number;

  /** Estimated token count */
  estimatedTokens: number;

  /** Memory type */
  type: string;
}

/**
 * Minimal message interface for memory operations.
 * The Memory interface accepts any message type that has this structure.
 */
export interface MinimalMessage {
  /** Message ID */
  id: string;

  /** Message role - must match the roles used in Message type */
  role: "user" | "assistant" | "system" | "tool";

  /** Message parts - any array of objects with type */
  parts: Array<{ type: string }>;

  /** Timestamp */
  timestamp?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory interface - core abstraction for conversation storage.
 *
 * Generic type M allows implementations to work with any message type
 * that satisfies MinimalMessage constraints.
 */
export interface Memory<M extends MinimalMessage = MinimalMessage> {
  /**
   * Add a message to memory
   */
  add(message: M): Promise<void>;

  /**
   * Get messages for the current context.
   */
  getMessages(): Promise<M[]>;

  /**
   * Clear all messages
   */
  clear(): Promise<void>;

  /**
   * Get memory stats
   */
  getStats(): Promise<MemoryStats>;
}

/**
 * Memory persistence interface (for future implementation)
 */
export interface MemoryPersistence<M extends MinimalMessage = MinimalMessage> {
  save(agentId: string, messages: M[]): Promise<void>;
  load(agentId: string): Promise<M[]>;
  clear(agentId: string): Promise<void>;
}

/**
 * Extract text content from message parts.
 * Works with any message part array that has type and optional text.
 */
export function getTextFromMemoryParts(
  parts: Array<{ type: string; text?: string }>,
): string {
  return parts
    .filter((p): p is { type: "text"; text: string } =>
      p.type === "text" && typeof p.text === "string"
    )
    .map((p) => p.text)
    .join("");
}

/**
 * Estimate token count for messages.
 * Uses a rough estimation of ~4 characters per token.
 */
export function estimateTokens(messages: MinimalMessage[]): number {
  const totalChars = messages.reduce(
    (sum, msg) => {
      const text = getTextFromMemoryParts(msg.parts as Array<{ type: string; text?: string }>);
      return sum + text.length;
    },
    0,
  );
  return Math.ceil(totalChars / 4);
}
