/**
 * ConversationStore — the async, swappable persistence adapter behind
 * {@link useConversations}. Mirrors the `BlobStorage` / `CacheStore` house
 * style: async methods, one action per method, optional capability methods.
 *
 * Swap the whole store (localStorage / IndexedDB / your API) or override a
 * single action by wrapping another store. The React hook drives the calls —
 * `list()` on mount, `load(id)` when active changes, `save()` (debounced) on
 * message/title change, `delete()` on remove — so adapters stay dumb and
 * batching lives in the hook.
 *
 * Two decisions that matter the moment you leave localStorage:
 * - `list()` returns **summaries** (no messages) so a sidebar never hauls every
 *   message of every conversation; `load(id)` fetches the full thread on open.
 * - ids are minted client-side, so `save()` is a create-or-update **upsert**
 *   (REST: idempotent `PUT {base}/{id}`) — no async "create returns id" dance.
 *
 * @module react/components/chat/persistence/conversation-store
 */
import type { ChatMessage } from "#veryfront/agent/react";

/** Persistence operation associated with a {@link ConversationStoreError}. */
export type ConversationStoreOperation = "list" | "load" | "save" | "delete" | "subscribe";

/**
 * Normalized persistence failure. Store implementations should reject rather
 * than resolve when an operation did not complete; the React hooks wrap custom
 * adapter rejections in this error so consumers can branch on `operation`
 * without parsing an error message.
 */
export class ConversationStoreError extends Error {
  /** Persistence operation that failed. */
  readonly operation: ConversationStoreOperation;

  constructor(operation: ConversationStoreOperation, cause: unknown) {
    super(`Conversation store ${operation} failed`, { cause });
    this.name = "ConversationStoreError";
    this.operation = operation;
  }
}

/** @internal Preserve an already-normalized failure or attach operation context. */
export function toConversationStoreError(
  operation: ConversationStoreOperation,
  cause: unknown,
): ConversationStoreError {
  return cause instanceof ConversationStoreError && cause.operation === operation
    ? cause
    : new ConversationStoreError(operation, cause);
}

/** Fields shared by a conversation and its list summary. */
interface ConversationMeta {
  id: string;
  title: string;
  /** Last agent this conversation talked to — lets a switcher restore per-thread. */
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Lightweight conversation metadata — what a list / sidebar needs (no messages). */
export interface ConversationSummary extends ConversationMeta {
  /** Number of messages, so a list can show "empty" / reuse an empty draft
   *  without loading the message blob. Derived from the conversation on save. */
  messageCount: number;
}

/** A full conversation — metadata + its messages. Fetched via {@link ConversationStore.load}. */
export interface Conversation extends ConversationMeta {
  messages: ChatMessage[];
}

/**
 * Async persistence contract for conversations. Implement all four methods;
 * `subscribe`/`dispose` are optional capabilities (feature-detect them).
 *
 * A hook owns the unsubscribe function returned by `subscribe`, but an
 * injected store remains caller-owned. Hooks never call `dispose`, including
 * during adapter replacement or unmount, because one store may be shared by
 * multiple consumers and retired writes are allowed to finish.
 */
export interface ConversationStore {
  /**
   * All conversations as summaries (no messages), newest first.
   * Reject when the list cannot be read or decoded.
   */
  list(): Promise<ConversationSummary[]>;
  /**
   * Load one full conversation (with messages). `null` only when it does not
   * exist; reject when persistence cannot be read or decoded.
   */
  load(id: string): Promise<Conversation | null>;
  /** Create-or-update by id (upsert). Reject unless the write completed. */
  save(conversation: Conversation): Promise<void>;
  /**
   * Delete a conversation. Idempotent for a missing id; reject unless deletion
   * completed.
   */
  delete(id: string): Promise<void>;
  /**
   * Optional: notify when conversations change out-of-band (another tab or
   * device). Returns an unsubscribe fn. Backends that can push (IndexedDB via
   * BroadcastChannel, an API via SSE) implement it; localStorage omits it.
   */
  subscribe?(onChange: (ids: string[]) => void): () => void;
  /**
   * Optional: release resources (sockets, db handles). The caller must invoke
   * this only after the store's final consumer and pending operation finish.
   */
  dispose?(): void;
}
