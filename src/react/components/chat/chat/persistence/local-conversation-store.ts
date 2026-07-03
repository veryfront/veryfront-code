/**
 * localConversationStore — the default {@link ConversationStore}, backed by
 * `localStorage`. Layout (matches the pre-adapter thread store, plus a richer
 * index so `list()` never has to read message blobs):
 *
 *   `{key}-index`  → ConversationSummary[]   (what the sidebar renders)
 *   `{key}-{id}`   → Conversation            (full, with messages)
 *
 * Methods are async to satisfy the interface even though localStorage is
 * synchronous — swapping in `idbConversationStore` / `apiConversationStore`
 * needs no caller changes. The backing store is injectable (a Web-Storage-like
 * object) so it's testable and degrades to a no-op on SSR / blocked storage.
 *
 * @module react/components/chat/persistence/local-conversation-store
 */
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import type { Conversation, ConversationStore, ConversationSummary } from "./conversation-store.ts";

/** The slice of the Web Storage API this adapter needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEFAULT_KEY = "vf-conversations";

const NOOP_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function defaultStorage(): StorageLike {
  if (!isBrowserEnvironment()) return NOOP_STORAGE;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? NOOP_STORAGE;
  } catch (_) {
    return NOOP_STORAGE; // access can throw (private mode, no --location, etc.)
  }
}

function toSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    ...(c.agentId ? { agentId: c.agentId } : {}),
    messageCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function byNewest(a: ConversationSummary, b: ConversationSummary): number {
  return b.updatedAt - a.updatedAt;
}

/**
 * localStorage-backed conversation persistence. Pass a `storage` to back it with
 * something else (tests inject an in-memory store); defaults to `localStorage`.
 */
export function localConversationStore(
  storageKey: string = DEFAULT_KEY,
  storage: StorageLike = defaultStorage(),
): ConversationStore {
  const indexKey = `${storageKey}-index`;
  const blobKey = (id: string) => `${storageKey}-${id}`;

  function readIndex(): ConversationSummary[] {
    try {
      const raw = storage.getItem(indexKey);
      if (raw) return (JSON.parse(raw) as ConversationSummary[]).sort(byNewest);
    } catch (_) { /* expected: corrupted / blocked storage */ }
    return [];
  }

  function writeIndex(summaries: ConversationSummary[]): void {
    try {
      storage.setItem(indexKey, JSON.stringify(summaries.sort(byNewest)));
    } catch (_) { /* expected: quota exceeded or blocked storage */ }
  }

  return {
    list(): Promise<ConversationSummary[]> {
      return Promise.resolve(readIndex());
    },

    load(id: string): Promise<Conversation | null> {
      try {
        const raw = storage.getItem(blobKey(id));
        if (raw) return Promise.resolve(JSON.parse(raw) as Conversation);
      } catch (_) { /* expected: corrupted / blocked storage */ }
      return Promise.resolve(null);
    },

    save(conversation: Conversation): Promise<void> {
      try {
        storage.setItem(blobKey(conversation.id), JSON.stringify(conversation));
        const summaries = readIndex().filter((s) => s.id !== conversation.id);
        summaries.push(toSummary(conversation));
        writeIndex(summaries);
      } catch (_) { /* expected: quota exceeded or blocked storage */ }
      return Promise.resolve();
    },

    delete(id: string): Promise<void> {
      try {
        storage.removeItem(blobKey(id));
        writeIndex(readIndex().filter((s) => s.id !== id));
      } catch (_) { /* expected: blocked storage */ }
      return Promise.resolve();
    },
  };
}
