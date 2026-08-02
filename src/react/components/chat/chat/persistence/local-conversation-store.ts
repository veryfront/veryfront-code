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
 * when it did not. Multi-key saves use a bounded rollback journal; deletes use
 * a compact roll-forward intent. Every locked operation resolves an interrupted
 * transaction before observing records. Successful writes restore a fixed-size
 * idle reservation so a current-format record remains deletable at quota.
 *
 * @module react/components/chat/persistence/local-conversation-store
 */
import { isBrowserEnvironment } from "#veryfront/platform/compat/runtime.ts";
import {
  CONVERSATION_STORAGE_FORMAT,
  CONVERSATION_STORAGE_LIMITS,
  CONVERSATION_STORAGE_VERSION,
  conversationBlobStorageKey,
  conversationIndexStorageKey,
  conversationTransactionJournalStorageKey,
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
const ArrayIsArray = Array.isArray;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
const ObjectCreate = Object.create;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const UTF8_ENCODER = new TextEncoder();

interface SaveTransactionJournalPrevious {
  readonly index: string | null;
  readonly currentBlob: string | null;
}

interface SaveTransactionJournal {
  readonly storageKey: string;
  readonly operation: "save";
  readonly id: string;
  readonly previous: SaveTransactionJournalPrevious;
}

interface DeleteTransactionJournal {
  readonly storageKey: string;
  readonly operation: "delete";
  readonly id: string;
  readonly ensureCurrentIndex: boolean;
}

type TransactionJournal = SaveTransactionJournal | DeleteTransactionJournal;
type CompleteDeleteIntent = (journal: DeleteTransactionJournal) => void;

interface RestoreResult {
  readonly complete: boolean;
  readonly failures: unknown[];
}

// Every successful save leaves this fixed-size value at the journal key. A
// compact delete intent is padded to no more than the same capacity, so replacing
// the reservation cannot require additional quota. NUL is the worst JSON escape
// expansion (six ASCII bytes per one-byte UTF-8 component), so the maximum is
// derived from the public component limits and this exact journal schema.
const MAX_STORAGE_KEY_COMPONENT_ESCAPE = "\0".repeat(
  CONVERSATION_STORAGE_LIMITS.maxStorageKeyComponentBytes,
);
const MAX_IDENTIFIER_ESCAPE = "\0".repeat(
  CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
);
const MAX_DELETE_JOURNAL_ENVELOPE = (() => {
  const envelope = ObjectCreate(null) as Record<string, unknown>;
  envelope.format = CONVERSATION_STORAGE_FORMAT;
  envelope.version = CONVERSATION_STORAGE_VERSION;
  envelope.kind = "transaction-journal";
  envelope.storageKey = MAX_STORAGE_KEY_COMPONENT_ESCAPE;
  envelope.operation = "delete";
  envelope.id = MAX_IDENTIFIER_ESCAPE;
  // `false` is one byte longer than `true` in JSON.
  envelope.ensureCurrentIndex = false;
  envelope.padding = "";
  const serialized = JSONStringify(envelope);
  if (serialized === undefined) {
    throw new TypeError("Conversation delete transaction envelope is not serializable");
  }
  return serialized;
})();
const TRANSACTION_RESERVATION_BYTES = UTF8_ENCODER.encode(
  MAX_DELETE_JOURNAL_ENVELOPE,
).byteLength;
const TRANSACTION_RESERVATION_PREFIX = "veryfront.conversation-store.transaction-reservation.v1";
const TRANSACTION_RESERVATION = TRANSACTION_RESERVATION_PREFIX + " ".repeat(
  TRANSACTION_RESERVATION_BYTES - TRANSACTION_RESERVATION_PREFIX.length,
);

// Derive the save-journal bound from its exact empty schema. A validated stored
// JSON before-image can at most double when embedded as a JSON string, while a
// key component can expand to six ASCII bytes per UTF-8 byte (`\u0000`).
const EMPTY_SAVE_JOURNAL_ENVELOPE_BYTES = (() => {
  const envelope = ObjectCreate(null) as Record<string, unknown>;
  envelope.format = CONVERSATION_STORAGE_FORMAT;
  envelope.version = CONVERSATION_STORAGE_VERSION;
  envelope.kind = "transaction-journal";
  envelope.storageKey = "";
  envelope.operation = "save";
  envelope.id = "";
  const previous = ObjectCreate(null) as Record<string, string>;
  previous.index = "";
  previous.currentBlob = "";
  envelope.previous = previous;
  envelope.padding = "";
  const serialized = JSONStringify(envelope);
  if (serialized === undefined) {
    throw new TypeError("Conversation save transaction envelope is not serializable");
  }
  return UTF8_ENCODER.encode(serialized).byteLength;
})();
const MAX_UNPADDED_SAVE_JOURNAL_BYTES = EMPTY_SAVE_JOURNAL_ENVELOPE_BYTES +
  6 *
    (CONVERSATION_STORAGE_LIMITS.maxStorageKeyComponentBytes +
      CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes) +
  2 *
    (CONVERSATION_STORAGE_LIMITS.maxIndexBytes +
      CONVERSATION_STORAGE_LIMITS.maxConversationBytes);
// TextEncoder emits at most three bytes per UTF-16 code unit. When the small
// save envelope is padded to cover both quota measures, three reservations are
// therefore a strict upper bound; large before-images use the schema bound.
const MAX_TRANSACTION_JOURNAL_BYTES = Math.max(
  MAX_UNPADDED_SAVE_JOURNAL_BYTES,
  3 * TRANSACTION_RESERVATION_BYTES,
);

class TransactionRecoveryError extends AggregateError {
  constructor(errors: Iterable<unknown>) {
    super(errors, "Conversation transaction recovery failed");
    this.name = "TransactionRecoveryError";
  }
}

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

function assertBoundedString(
  value: unknown,
  maxBytes: number,
  label: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (value.length > maxBytes || UTF8_ENCODER.encode(value).byteLength > maxBytes) {
    throw new TypeError(`${label} exceeds ${maxBytes} bytes`);
  }
}

function assertNullableBoundedString(
  value: unknown,
  maxBytes: number,
  label: string,
): asserts value is string | null {
  if (value === null) return;
  assertBoundedString(value, maxBytes, label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayIsArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = ObjectKeys(value);
  if (keys.length !== expected.length) {
    throw new TypeError(`${label} has unexpected fields`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (!ObjectHasOwn(value, expected[index]!)) {
      throw new TypeError(`${label} has unexpected fields`);
    }
  }
}

function journalByteLength(raw: string): number {
  if (raw.length > MAX_TRANSACTION_JOURNAL_BYTES) {
    throw new TypeError(
      `Conversation transaction journal exceeds ${MAX_TRANSACTION_JOURNAL_BYTES} bytes`,
    );
  }
  const bytes = UTF8_ENCODER.encode(raw).byteLength;
  if (bytes > MAX_TRANSACTION_JOURNAL_BYTES) {
    throw new TypeError(
      `Conversation transaction journal exceeds ${MAX_TRANSACTION_JOURNAL_BYTES} bytes`,
    );
  }
  return bytes;
}

function assertPadding(value: unknown): asserts value is string {
  assertBoundedString(
    value,
    MAX_TRANSACTION_JOURNAL_BYTES,
    "Conversation transaction journal padding",
  );
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x20) {
      throw new TypeError("Conversation transaction journal padding is invalid");
    }
  }
}

function serializePaddedJournalEnvelope(
  envelope: Record<string, unknown>,
  exactReservationSize: boolean,
): string {
  envelope.padding = "";
  let serialized = JSONStringify(envelope);
  if (serialized === undefined) {
    throw new TypeError("Conversation transaction journal is not serializable");
  }
  let bytes = journalByteLength(serialized);
  if (exactReservationSize && bytes > TRANSACTION_RESERVATION_BYTES) {
    throw new TypeError("Conversation delete transaction exceeds its reserved capacity");
  }
  const paddingLength = exactReservationSize ? TRANSACTION_RESERVATION_BYTES - bytes : Math.max(
    TRANSACTION_RESERVATION_BYTES - bytes,
    TRANSACTION_RESERVATION_BYTES - serialized.length,
  );
  if (paddingLength > 0) {
    envelope.padding = " ".repeat(paddingLength);
    serialized = JSONStringify(envelope);
    if (serialized === undefined) {
      throw new TypeError("Conversation transaction journal is not serializable");
    }
    bytes = journalByteLength(serialized);
  }
  if (exactReservationSize && bytes !== TRANSACTION_RESERVATION_BYTES) {
    throw new TypeError("Conversation delete transaction reservation is invalid");
  }
  return serialized;
}

function encodeTransactionJournal(journal: TransactionJournal): string {
  const envelope = ObjectCreate(null) as Record<string, unknown>;
  envelope.format = CONVERSATION_STORAGE_FORMAT;
  envelope.version = CONVERSATION_STORAGE_VERSION;
  envelope.kind = "transaction-journal";
  envelope.storageKey = journal.storageKey;
  envelope.operation = journal.operation;
  envelope.id = journal.id;
  if (journal.operation === "save") {
    const previous = ObjectCreate(null) as Record<string, string | null>;
    previous.index = journal.previous.index;
    previous.currentBlob = journal.previous.currentBlob;
    envelope.previous = previous;
  } else {
    envelope.ensureCurrentIndex = journal.ensureCurrentIndex;
  }
  const serialized = serializePaddedJournalEnvelope(
    envelope,
    journal.operation === "delete",
  );
  // Never persist a journal that this version could not recover after a crash.
  decodeTransactionJournal(serialized, journal.storageKey);
  return serialized;
}

function decodeTransactionJournal(
  raw: string,
  expectedStorageKey: string,
): TransactionJournal {
  const rawBytes = journalByteLength(raw);
  let parsed: unknown;
  try {
    parsed = JSONParse(raw);
  } catch (cause) {
    throw new TypeError("Conversation transaction journal is not valid JSON", { cause });
  }
  if (!isRecord(parsed)) {
    throw new TypeError("Conversation transaction journal must be an object");
  }
  if (
    parsed.format !== CONVERSATION_STORAGE_FORMAT ||
    parsed.version !== CONVERSATION_STORAGE_VERSION ||
    parsed.kind !== "transaction-journal"
  ) {
    throw new TypeError("Unsupported conversation transaction journal envelope");
  }
  if (parsed.storageKey !== expectedStorageKey) {
    throw new TypeError("Conversation transaction journal belongs to another namespace");
  }
  if (parsed.operation !== "save" && parsed.operation !== "delete") {
    throw new TypeError("Conversation transaction journal operation is invalid");
  }
  assertExactKeys(
    parsed,
    parsed.operation === "save"
      ? [
        "format",
        "version",
        "kind",
        "storageKey",
        "operation",
        "id",
        "previous",
        "padding",
      ]
      : [
        "format",
        "version",
        "kind",
        "storageKey",
        "operation",
        "id",
        "ensureCurrentIndex",
        "padding",
      ],
    "Conversation transaction journal",
  );
  assertPadding(parsed.padding);
  assertBoundedString(
    parsed.id,
    CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes,
    "Conversation transaction journal id",
  );
  // Reuse the canonical tuple-key validator rather than accepting an id that
  // recovery could not map to exactly one current record.
  conversationBlobStorageKey(expectedStorageKey, parsed.id);

  if (parsed.operation === "delete") {
    if (rawBytes !== TRANSACTION_RESERVATION_BYTES) {
      throw new TypeError("Conversation delete transaction reservation is invalid");
    }
    if (typeof parsed.ensureCurrentIndex !== "boolean") {
      throw new TypeError("Conversation delete transaction index intent is invalid");
    }
    return {
      storageKey: expectedStorageKey,
      operation: "delete",
      id: parsed.id,
      ensureCurrentIndex: parsed.ensureCurrentIndex,
    };
  }

  if (!isRecord(parsed.previous)) {
    throw new TypeError("Conversation transaction journal before-image is invalid");
  }
  assertExactKeys(
    parsed.previous,
    ["index", "currentBlob"],
    "Conversation transaction journal before-image",
  );
  assertNullableBoundedString(
    parsed.previous.index,
    CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
    "Conversation transaction journal index before-image",
  );
  if (parsed.previous.index !== null) {
    decodeConversationIndex(parsed.previous.index);
  }
  assertNullableBoundedString(
    parsed.previous.currentBlob,
    CONVERSATION_STORAGE_LIMITS.maxConversationBytes,
    "Conversation transaction journal blob before-image",
  );
  if (
    parsed.previous.currentBlob !== null &&
    decodeConversationRecord(parsed.previous.currentBlob).value.id !== parsed.id
  ) {
    throw new TypeError("Conversation transaction journal blob id is invalid");
  }

  return {
    storageKey: expectedStorageKey,
    operation: "save",
    id: parsed.id,
    previous: {
      index: parsed.previous.index,
      currentBlob: parsed.previous.currentBlob,
    },
  };
}

function restoreItems(
  storage: StorageLike,
  previousItems: readonly { key: string; value: string | null }[],
): RestoreResult {
  const failures: unknown[] = [];
  let complete = true;
  for (const item of previousItems) {
    let current: string | null;
    try {
      current = storage.getItem(item.key);
    } catch (cause) {
      failures.push(cause);
      complete = false;
      continue;
    }
    if (current === item.value) continue;

    try {
      if (item.value === null) storage.removeItem(item.key);
      else storage.setItem(item.key, item.value);
    } catch (cause) {
      failures.push(cause);
    }
    try {
      if (storage.getItem(item.key) !== item.value) {
        failures.push(new Error("Conversation transaction before-image was not restored"));
        complete = false;
      }
    } catch (cause) {
      failures.push(cause);
      complete = false;
    }
  }
  return { complete, failures };
}

function installTransactionReservation(
  storage: StorageLike,
  journalKey: string,
): RestoreResult {
  const failures: unknown[] = [];
  let current: string | null;
  try {
    current = storage.getItem(journalKey);
  } catch (cause) {
    failures.push(cause);
    return { complete: false, failures };
  }
  if (current === TRANSACTION_RESERVATION) return { complete: true, failures };

  try {
    storage.setItem(journalKey, TRANSACTION_RESERVATION);
  } catch (cause) {
    failures.push(cause);
  }
  try {
    const complete = storage.getItem(journalKey) === TRANSACTION_RESERVATION;
    if (complete) {
      return { complete: true, failures };
    }
    if (failures.length === 0) {
      failures.push(new Error("Conversation transaction reservation was not installed"));
    }
    return { complete: false, failures };
  } catch (cause) {
    failures.push(cause);
    return { complete: false, failures };
  }
}

function restoreSaveTransaction(
  storageKey: string,
  storage: StorageLike,
  journal: SaveTransactionJournal,
): RestoreResult {
  return restoreItems(storage, [
    {
      key: conversationIndexStorageKey(storageKey),
      value: journal.previous.index,
    },
    {
      key: conversationBlobStorageKey(storageKey, journal.id),
      value: journal.previous.currentBlob,
    },
  ]);
}

function recoverPendingTransaction(
  storageKey: string,
  storage: StorageLike,
  completeDeleteIntent: CompleteDeleteIntent,
): void {
  const journalKey = conversationTransactionJournalStorageKey(storageKey);
  const raw = storage.getItem(journalKey);
  if (raw === null || raw === TRANSACTION_RESERVATION) return;

  const journal = decodeTransactionJournal(raw, storageKey);
  let restored: RestoreResult;
  if (journal.operation === "save") {
    restored = restoreSaveTransaction(storageKey, storage, journal);
  } else {
    try {
      completeDeleteIntent(journal);
      restored = { complete: true, failures: [] };
    } catch (cause) {
      restored = { complete: false, failures: [cause] };
    }
  }

  let complete = restored.complete;
  const failures = [...restored.failures];
  // A recovery write that threw remains diagnostically significant even when a
  // verification read observes the requested value. Surface that failure
  // instead of claiming success. Before-image failures leave the active journal
  // available for the next locked operation; a reservation write may already
  // have replaced it with the verified idle marker.
  if (complete && failures.length === 0) {
    const reserved = installTransactionReservation(storage, journalKey);
    complete = reserved.complete;
    failures.push(...reserved.failures);
  }
  if (!complete || failures.length > 0) {
    throw new TransactionRecoveryError(failures);
  }
}

function recoveryFailures(cause: unknown): unknown[] {
  return cause instanceof TransactionRecoveryError ? [...cause.errors] : [cause];
}

function throwTransactionFailures(failures: readonly unknown[], message: string): never {
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, message);
}

function requireTransactionReservation(storage: StorageLike, journalKey: string): void {
  const reserved = installTransactionReservation(storage, journalKey);
  if (!reserved.complete || reserved.failures.length > 0) {
    throwTransactionFailures(
      reserved.failures,
      "Conversation transaction reservation could not be installed",
    );
  }
}

function executeSaveTransaction(
  storageKey: string,
  storage: StorageLike,
  journal: SaveTransactionJournal,
  mutate: () => void,
  completeDeleteIntent: CompleteDeleteIntent,
): void {
  const journalKey = conversationTransactionJournalStorageKey(storageKey);
  const serialized = encodeTransactionJournal(journal);
  try {
    storage.setItem(journalKey, serialized);
    if (storage.getItem(journalKey) !== serialized) {
      throw new Error("Conversation transaction journal write could not be verified");
    }
    mutate();
    requireTransactionReservation(storage, journalKey);
  } catch (cause) {
    try {
      recoverPendingTransaction(storageKey, storage, completeDeleteIntent);
    } catch (recoveryCause) {
      throw new AggregateError(
        [cause, ...recoveryFailures(recoveryCause)],
        "Conversation transaction and recovery both failed",
      );
    }
    throw cause;
  }
}

function executeDeleteTransaction(
  storageKey: string,
  storage: StorageLike,
  journal: DeleteTransactionJournal,
  completeDeleteIntent: CompleteDeleteIntent,
): void {
  const journalKey = conversationTransactionJournalStorageKey(storageKey);
  const serialized = encodeTransactionJournal(journal);
  try {
    storage.setItem(journalKey, serialized);
    if (storage.getItem(journalKey) !== serialized) {
      throw new Error("Conversation delete intent write could not be verified");
    }
    completeDeleteIntent(journal);
    requireTransactionReservation(storage, journalKey);
  } catch (cause) {
    try {
      recoverPendingTransaction(storageKey, storage, completeDeleteIntent);
    } catch (recoveryCause) {
      throw new AggregateError(
        [cause, ...recoveryFailures(recoveryCause)],
        "Conversation deletion and recovery both failed",
      );
    }
    throw cause;
  }
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

  function completeDeleteIntent(journal: DeleteTransactionJournal): void {
    const keys = blobKeys(journal.id);
    const indexKey = indexKeys().current;

    if (storage.getItem(keys.current) !== null) {
      storage.removeItem(keys.current);
    }
    if (keys.legacy !== null) {
      const legacy = storage.getItem(keys.legacy);
      if (legacy !== null) {
        let ownsLegacyBlob = false;
        try {
          const decoded = decodeConversationRecord(legacy);
          ownsLegacyBlob = decoded.legacy && decoded.value.id === journal.id;
        } catch {
          // A corrupt or cross-namespace legacy value is not owned by this
          // logical record and must never be removed speculatively.
        }
        if (ownsLegacyBlob && storage.getItem(keys.legacy) === legacy) {
          storage.removeItem(keys.legacy);
        }
      }
    }

    if (journal.ensureCurrentIndex) {
      const remaining = readIndexState().summaries.filter(
        (summary) => summary.id !== journal.id,
      );
      const encoded = encodeConversationIndex(remaining);
      if (storage.getItem(indexKey) !== encoded.serialized) {
        storage.setItem(indexKey, encoded.serialized);
      }
    }

    if (storage.getItem(keys.current) !== null) {
      throw new Error("Conversation delete did not remove the current record");
    }
    if (keys.legacy !== null) {
      const legacy = storage.getItem(keys.legacy);
      if (legacy !== null) {
        let ownedLegacyRemains = false;
        try {
          const decoded = decodeConversationRecord(legacy);
          ownedLegacyRemains = decoded.legacy && decoded.value.id === journal.id;
        } catch {
          // A value that cannot prove ownership remains untouched.
        }
        if (ownedLegacyRemains) {
          throw new Error("Conversation delete did not remove the owned legacy record");
        }
      }
    }
    if (journal.ensureCurrentIndex) {
      const current = storage.getItem(indexKey);
      if (current === null) {
        throw new Error("Conversation delete did not publish its index tombstone");
      }
      if (decodeConversationIndex(current).value.some((summary) => summary.id === journal.id)) {
        throw new Error("Conversation delete left the record in the current index");
      }
    }
  }

  function runLocked<T>(criticalSection: () => T | PromiseLike<T>): Promise<T> {
    // Validate the namespace before handing it to a host API. Keep the lock
    // identity independent of the persisted format version so migrations and
    // current writers still coordinate.
    conversationIndexStorageKey(storageKey);
    conversationTransactionJournalStorageKey(storageKey);
    return lockRunner.run(conversationStoreLockName(storageKey), () => {
      recoverPendingTransaction(storageKey, storage, completeDeleteIntent);
      return criticalSection();
    });
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

          executeSaveTransaction(
            storageKey,
            storage,
            {
              storageKey,
              operation: "save",
              id: value.id,
              previous: {
                index: previousIndex,
                currentBlob: previousBlob,
              },
            },
            () => {
              storage.setItem(key, serialized);
              storage.setItem(indexKey, encodedIndex.serialized);
            },
            completeDeleteIntent,
          );
        });
      });
    },

    delete(id: string): Promise<void> {
      return runOperation("delete", () => {
        const keys = blobKeys(id);
        return runLocked(() => {
          const previousCurrentBlob = storage.getItem(keys.current);
          const previousLegacyBlob = keys.legacy === null ? null : storage.getItem(keys.legacy);
          // A concatenated legacy key can collide across namespaces. Delete it
          // only when its decoded id proves that this logical record owns it.
          // Otherwise a v1 index omission is the safe logical tombstone.
          let removeLegacyBlob = false;
          if (previousLegacyBlob !== null) {
            try {
              const decoded = decodeConversationRecord(previousLegacyBlob);
              removeLegacyBlob = decoded.legacy && decoded.value.id === id;
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

          // Once a delete intent is durable it must always be possible to
          // finish. A maximum-size legacy array can fit its old raw limit while
          // the current envelope for its tombstone does not, so prove the exact
          // remaining index encodes before the intent can remove any record.
          if (removedFromIndex || needsTombstone) {
            encodeConversationIndex(remaining);
          }

          executeDeleteTransaction(
            storageKey,
            storage,
            {
              storageKey,
              operation: "delete",
              id,
              ensureCurrentIndex: removedFromIndex || needsTombstone,
            },
            completeDeleteIntent,
          );
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
