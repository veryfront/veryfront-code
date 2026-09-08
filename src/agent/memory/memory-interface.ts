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

const hasOwn = Object.hasOwn;
const ceil = Math.ceil;

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
  /** Required for custom backends used with transactional input validation. */
  beginTransaction?(): Promise<MemoryTransaction<M>>;
}

/**
 * An isolated view of one turn, including your backend's retention policy.
 *
 * Your backend must stage writes until commit. Commit must atomically verify
 * that the validated snapshot is still current and publish the staged state,
 * or reject without publishing it. Concurrent additions and clears must cause
 * a conflict, never overwrite newer history. Rollback discards only this
 * transaction's work, including after a failed add or commit, and releases
 * backend resources. Commit and rollback must be safe to call repeatedly.
 */
export interface MemoryTransaction<M extends MinimalMessage = MinimalMessage> {
  /** Stage caller, assistant, or tool messages without publishing them. */
  add(message: M): Promise<void>;
  /** Read the snapshot and staged messages that validation must examine. */
  getMessages(): Promise<M[]>;
  /** Atomically publish the validated view, rejecting concurrent changes. */
  commit(): Promise<void>;
  /** Discard this transaction's work without restoring or clearing shared history. */
  rollback(): Promise<void>;
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
  let text = "";
  for (let index = 0; index < parts.length; index++) {
    if (!hasOwn(parts, index)) continue;
    const part = parts[index]!;
    const value = part.type === "text" ? part.text : undefined;
    if (typeof value === "string") text += value;
  }
  return text;
}

export function estimateTokens(messages: MinimalMessage[]): number {
  let totalChars = 0;
  for (let index = 0; index < messages.length; index++) {
    if (!hasOwn(messages, index)) continue;
    const msg = messages[index]!;
    const text = getTextFromMemoryParts(
      msg.parts as Array<{ type: string; text?: string }>,
    );
    totalChars += text.length;
  }

  return ceil(totalChars / 4);
}
