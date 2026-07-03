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

/** Lightweight conversation metadata — what a list / sidebar needs (no messages). */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Last agent this conversation talked to — lets a switcher restore per-thread. */
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

/** A full conversation — summary + its messages. Fetched via {@link ConversationStore.load}. */
export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}

/**
 * Async persistence contract for conversations. Implement all four methods;
 * `subscribe`/`dispose` are optional capabilities (feature-detect them).
 */
export interface ConversationStore {
  /** All conversations as summaries (no messages), newest first. */
  list(): Promise<ConversationSummary[]>;
  /** Load one full conversation (with messages). `null` if it does not exist. */
  load(id: string): Promise<Conversation | null>;
  /** Create-or-update by id (upsert). */
  save(conversation: Conversation): Promise<void>;
  /** Delete a conversation. Idempotent — deleting a missing id is not an error. */
  delete(id: string): Promise<void>;
  /**
   * Optional: notify when conversations change out-of-band (another tab or
   * device). Returns an unsubscribe fn. Backends that can push (IndexedDB via
   * BroadcastChannel, an API via SSE) implement it; localStorage omits it.
   */
  subscribe?(onChange: (ids: string[]) => void): () => void;
  /** Optional: release resources (sockets, db handles). */
  dispose?(): void;
}
