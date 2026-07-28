/**
 * localConversationStore — the default {@link ConversationStore}, backed by
 * `localStorage`. Current records use injective, versioned tuple keys and
 * envelopes. The legacy layout remains read-only input for lazy migration:
 *
 *   `{key}-index`  → ConversationSummary[]
 *   `{key}-{id}`   → Conversation
 *
 * Methods are async to satisfy the interface even though localStorage is
 * synchronous — swapping in `idbConversationStore` / `apiConversationStore`
 * needs no caller changes. The backing store is injectable (a Web-Storage-like
 * object) so it's testable. Unavailable, blocked, corrupt, and quota-limited
 * storage rejects explicitly; callers must never be told an operation persisted
 * when it did not.
 *
 * @module react/components/chat/persistence/local-conversation-store
 */
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import {
  conversationBlobStorageKey,
  conversationIndexStorageKey,
  decodeConversationIndex,
  decodeConversationRecord,
  encodeConversationIndex,
  encodeConversationRecord,
  legacyConversationBlobStorageKey,
  legacyConversationIndexStorageKey,
} from "./conversation-codec.ts";
import {
  type Conversation,
  type ConversationStore,
  type ConversationStoreOperation,
  type ConversationSummary,
  toConversationStoreError,
} from "./conversation-store.ts";
import {
  browserConversationStoreLockRunner,
  conversationStoreLockName,
  type ConversationStoreLockRunner,
} from "./conversation-store-lock.ts";

/** The slice of the Web Storage API this adapter needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEFAULT_KEY = "vf-conversations";

function unavailableStorage(cause: unknown): StorageLike {
  const fail = (): never => {
    throw cause;
  };
  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
  };
}

function defaultStorage(): StorageLike {
  if (!isBrowserEnvironment()) {
    return unavailableStorage(new Error("localStorage is unavailable outside a browser"));
  }
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ??
      unavailableStorage(new Error("localStorage is not available in this browser context"));
  } catch (cause) {
    return unavailableStorage(cause);
  }
}

function toSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    ...(c.agentId !== undefined ? { agentId: c.agentId } : {}),
    messageCount: c.messages.length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function byNewest(a: ConversationSummary, b: ConversationSummary): number {
  return b.updatedAt - a.updatedAt;
}

async function runOperation<T>(
  operation: ConversationStoreOperation,
  action: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await action();
  } catch (cause) {
    throw toConversationStoreError(operation, cause);
  }
}

function restoreItem(storage: StorageLike, key: string, previous: string | null): void {
  if (previous === null) storage.removeItem(key);
  else storage.setItem(key, previous);
}

function rollbackItems(
  storage: StorageLike,
  previousItems: readonly { key: string; value: string | null }[],
): unknown[] {
  const failures: unknown[] = [];
  for (const item of previousItems) {
    try {
      restoreItem(storage, item.key, item.value);
    } catch (cause) {
      failures.push(cause);
    }
  }
  return failures;
}

/**
 * @internal Construct the adapter with an explicit lock runner. This seam keeps
 * contract tests independent of browser globals; production callers should use
 * {@link localConversationStore}.
 */
export function createLocalConversationStore(
  storageKey: string,
  storage: StorageLike,
  lockRunner: ConversationStoreLockRunner,
): ConversationStore {
  function indexKeys(): { current: string; legacy: string } {
    return {
      current: conversationIndexStorageKey(storageKey),
      legacy: legacyConversationIndexStorageKey(storageKey),
    };
  }

  function blobKeys(id: string): { current: string; legacy: string | null } {
    const current = conversationBlobStorageKey(storageKey, id);
    const legacy = legacyConversationBlobStorageKey(storageKey, id);
    const legacyIndex = legacyConversationIndexStorageKey(storageKey);
    return { current, legacy: legacy === legacyIndex ? null : legacy };
  }

  function isForeignLegacyBlobAtKey(raw: string, key: string): boolean {
    try {
      const decoded = decodeConversationRecord(raw);
      if (!decoded.legacy) return false;
      const idSuffix = `-${decoded.value.id}`;
      if (!key.endsWith(idSuffix)) return false;
      const foreignStorageKey = key.slice(0, -idSuffix.length);
      return foreignStorageKey.length > 0 &&
        foreignStorageKey !== storageKey &&
        legacyConversationBlobStorageKey(foreignStorageKey, decoded.value.id) === key;
    } catch {
      return false;
    }
  }

  function isForeignLegacyIndexAtKey(raw: string, key: string): boolean {
    try {
      const decoded = decodeConversationIndex(raw);
      if (!decoded.legacy || !key.endsWith("-index")) return false;
      const foreignStorageKey = key.slice(0, -"-index".length);
      return foreignStorageKey.length > 0 &&
        foreignStorageKey !== storageKey &&
        legacyConversationIndexStorageKey(foreignStorageKey) === key;
    } catch {
      return false;
    }
  }

  function readIndexState(): {
    summaries: ConversationSummary[];
    current: boolean;
  } {
    const keys = indexKeys();
    const current = storage.getItem(keys.current);
    if (current !== null) {
      return {
        summaries: decodeConversationIndex(current).value,
        current: true,
      };
    }
    const legacy = storage.getItem(keys.legacy);
    if (legacy === null) {
      return { summaries: [], current: false };
    }
    try {
      return {
        summaries: decodeConversationIndex(legacy).value,
        current: false,
      };
    } catch (cause) {
      // Flattened legacy keys are not injective. A legacy index key can be a
      // different namespace's valid blob key, so ignore only collisions whose
      // decoded id reconstructs that exact foreign key.
      if (isForeignLegacyBlobAtKey(legacy, keys.legacy)) {
        return { summaries: [], current: false };
      }
      throw cause;
    }
  }

  function readIndex(): ConversationSummary[] {
    return readIndexState().summaries;
  }

  function runLocked<T>(criticalSection: () => T | PromiseLike<T>): Promise<T> {
    // Validate the namespace before handing it to a host API. Keep the lock
    // identity independent of the persisted format version so migrations and
    // current writers still coordinate.
    conversationIndexStorageKey(storageKey);
    return lockRunner.run(conversationStoreLockName(storageKey), criticalSection);
  }

  return {
    list(): Promise<ConversationSummary[]> {
      return runOperation("list", () => runLocked(readIndex));
    },

    load(id: string): Promise<Conversation | null> {
      return runOperation("load", () => {
        const keys = blobKeys(id);
        return runLocked(() => {
          let raw = storage.getItem(keys.current);
          let readLegacyBlob = false;
          let unlistedLegacyFallback = false;
          if (raw === null && keys.legacy !== null) {
            const index = readIndexState();
            const listed = index.summaries.some((summary) => summary.id === id);
            if (listed) {
              raw = storage.getItem(keys.legacy);
              readLegacyBlob = true;
            } else if (!index.current) {
              // Old writers could leave a valid blob orphaned when their
              // best-effort index write failed. The concatenated legacy key is
              // also ambiguous across namespaces, so an unlisted fallback is
              // accepted only when it decodes to the requested id.
              raw = storage.getItem(keys.legacy);
              readLegacyBlob = true;
              unlistedLegacyFallback = true;
            }
          }
          if (raw === null) return null;
          let conversation: Conversation;
          try {
            conversation = decodeConversationRecord(raw).value;
          } catch (cause) {
            if (
              unlistedLegacyFallback ||
              (readLegacyBlob &&
                keys.legacy !== null &&
                isForeignLegacyIndexAtKey(raw, keys.legacy))
            ) {
              return null;
            }
            throw cause;
          }
          if (conversation.id !== id) {
            if (
              unlistedLegacyFallback ||
              (readLegacyBlob &&
                keys.legacy !== null &&
                isForeignLegacyBlobAtKey(raw, keys.legacy))
            ) {
              return null;
            }
            throw new TypeError("Stored conversation id does not match its storage key");
          }
          return conversation;
        });
      });
    },

    save(conversation: Conversation): Promise<void> {
      return runOperation("save", () => {
        // Snapshot before the first await so caller mutation after save() cannot
        // change the record that this invocation persists.
        const { serialized, value } = encodeConversationRecord(conversation);
        const key = blobKeys(value.id).current;
        return runLocked(() => {
          const indexKey = indexKeys().current;
          const previousBlob = storage.getItem(key);
          const previousIndex = storage.getItem(indexKey);
          const summaries = readIndex().filter((summary) => summary.id !== value.id);
          summaries.push(toSummary(value));
          const encodedIndex = encodeConversationIndex([...summaries].sort(byNewest));

          try {
            storage.setItem(key, serialized);
            storage.setItem(indexKey, encodedIndex.serialized);
          } catch (cause) {
            const rollbackFailures = rollbackItems(storage, [
              { key: indexKey, value: previousIndex },
              { key, value: previousBlob },
            ]);
            if (rollbackFailures.length > 0) {
              throw new AggregateError(
                [cause, ...rollbackFailures],
                "Conversation save and rollback both failed",
              );
            }
            throw cause;
          }
        });
      });
    },

    delete(id: string): Promise<void> {
      return runOperation("delete", () => {
        const keys = blobKeys(id);
        return runLocked(() => {
          const indexKey = indexKeys().current;
          const previousCurrentBlob = storage.getItem(keys.current);
          const previousIndex = storage.getItem(indexKey);
          const previousLegacyBlob = keys.legacy === null ? null : storage.getItem(keys.legacy);
          // A concatenated legacy key can collide across namespaces. Delete it
          // only when its decoded id proves that this logical record owns it.
          // Otherwise a v1 index omission is the safe logical tombstone.
          let removeLegacyBlob = false;
          if (previousLegacyBlob !== null) {
            try {
              removeLegacyBlob = decodeConversationRecord(previousLegacyBlob).value.id === id;
            } catch {
              // Corrupt or foreign legacy bytes cannot be attributed safely.
            }
          }
          const index = readIndexState();
          const summaries = index.summaries;
          const remaining = summaries.filter((summary) => summary.id !== id);
          const removedFromIndex = remaining.length !== summaries.length;
          const needsTombstone = !index.current && previousLegacyBlob !== null;
          if (
            previousCurrentBlob === null &&
            !removedFromIndex &&
            !needsTombstone &&
            !removeLegacyBlob
          ) {
            return;
          }

          const encodedIndex = removedFromIndex || needsTombstone
            ? encodeConversationIndex(remaining)
            : null;
          try {
            storage.removeItem(keys.current);
            if (removeLegacyBlob && keys.legacy !== null) {
              storage.removeItem(keys.legacy);
            }
            if (encodedIndex !== null) {
              storage.setItem(indexKey, encodedIndex.serialized);
            }
          } catch (cause) {
            const rollbackFailures = rollbackItems(storage, [
              { key: indexKey, value: previousIndex },
              ...(removeLegacyBlob && keys.legacy !== null
                ? [{ key: keys.legacy, value: previousLegacyBlob }]
                : []),
              { key: keys.current, value: previousCurrentBlob },
            ]);
            if (rollbackFailures.length > 0) {
              throw new AggregateError(
                [cause, ...rollbackFailures],
                "Conversation delete and rollback both failed",
              );
            }
            throw cause;
          }
        });
      });
    },
  };
}

/**
 * localStorage-backed conversation persistence. Pass a `storage` to back it
 * with another Web-Storage-like implementation. Every operation requires the
 * Web Locks API so concurrent browser contexts cannot lose index updates.
 */
export function localConversationStore(
  storageKey: string = DEFAULT_KEY,
  storage: StorageLike = defaultStorage(),
): ConversationStore {
  return createLocalConversationStore(
    storageKey,
    storage,
    browserConversationStoreLockRunner,
  );
}
