import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  CONVERSATION_STORAGE_FORMAT,
  CONVERSATION_STORAGE_LIMITS,
  CONVERSATION_STORAGE_VERSION,
  conversationBlobStorageKey,
  conversationIndexStorageKey,
  conversationTransactionJournalStorageKey,
  legacyConversationBlobStorageKey,
  legacyConversationIndexStorageKey,
} from "./conversation-codec.ts";
import {
  type Conversation,
  type ConversationStore,
  ConversationStoreError,
} from "./conversation-store.ts";
import {
  conversationStoreLockName,
  type ConversationStoreLockRunner,
} from "./conversation-store-lock.ts";
import {
  createLocalConversationStore,
  localConversationStore,
  type StorageLike,
} from "./local-conversation-store.ts";
import { memoryConversationStore } from "./memory-conversation-store.ts";

function msg(text: string): ChatMessage {
  return { id: `m-${text}`, role: "user", parts: [{ type: "text", text }] } as ChatMessage;
}

function conversation(id: string, at: number, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    messages: [msg(`hello ${id}`)],
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}

/** An in-memory `StorageLike` so the localStorage adapter is testable in Deno. */
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

interface QuotaStorage extends StorageLike {
  readonly quotaError: DOMException;
  usage(): number;
  setQuota(value: number): void;
}

function quotaStorage(): QuotaStorage {
  const map = new Map<string, string>();
  const quotaError = new DOMException("Storage quota exceeded", "QuotaExceededError");
  let quota = Number.POSITIVE_INFINITY;
  const usage = (): number => {
    let total = 0;
    for (const [key, value] of map) total += key.length + value.length;
    return total;
  };
  return {
    quotaError,
    usage,
    setQuota(value) {
      quota = value;
    },
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      const previous = map.get(key);
      const nextUsage = usage() - (previous === undefined ? 0 : key.length + previous.length) +
        key.length + value.length;
      if (nextUsage > quota) throw quotaError;
      map.set(key, value);
    },
    removeItem: (key) => void map.delete(key),
  };
}

function interruptAfterMutation(base: StorageLike, ordinal: number): StorageLike {
  const termination = new Error(`simulated termination after mutation ${ordinal}`);
  let mutations = 0;
  let terminated = false;

  const assertRunning = (): void => {
    if (terminated) throw termination;
  };
  const mutated = (): void => {
    mutations += 1;
    if (mutations === ordinal) {
      terminated = true;
      throw termination;
    }
  };

  return {
    getItem(key) {
      assertRunning();
      return base.getItem(key);
    },
    setItem(key, value) {
      assertRunning();
      base.setItem(key, value);
      mutated();
    },
    removeItem(key) {
      assertRunning();
      base.removeItem(key);
      mutated();
    },
  };
}

function transactionJournalRaw(
  storageKey: string,
  id: string,
  over: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    format: CONVERSATION_STORAGE_FORMAT,
    version: CONVERSATION_STORAGE_VERSION,
    kind: "transaction-journal",
    storageKey,
    operation: "save",
    id,
    previous: { index: null, currentBlob: null },
    padding: "",
    ...over,
  });
}

function assertTransactionReservation(storage: StorageLike, storageKey: string): void {
  const raw = storage.getItem(conversationTransactionJournalStorageKey(storageKey));
  assert(raw !== null);
  assert(raw.startsWith("veryfront.conversation-store.transaction-reservation.v1"));
}

const immediateLockRunner: ConversationStoreLockRunner = {
  async run<T>(
    _name: string,
    criticalSection: () => T | PromiseLike<T>,
  ): Promise<T> {
    return await criticalSection();
  },
};

function testLocalConversationStore(
  storageKey: string,
  storage: StorageLike = fakeStorage(),
  lockRunner: ConversationStoreLockRunner = immediateLockRunner,
): ConversationStore {
  return createLocalConversationStore(storageKey, storage, lockRunner);
}

// One contract, run against every adapter — the whole point of the abstraction.
function runContract(name: string, makeStore: () => ConversationStore): void {
  describe(`ConversationStore contract — ${name}`, () => {
    it("starts empty", async () => {
      assertEquals(await makeStore().list(), []);
    });

    it("save then list returns summaries (newest first, no messages)", async () => {
      const store = makeStore();
      await store.save(conversation("a", 100));
      await store.save(conversation("b", 200, { agentId: "" }));

      const summaries = await store.list();
      assertEquals(summaries.map((s) => s.id), ["b", "a"], "newest updatedAt first");
      // Summaries are lightweight — no messages hauled for the list, but the
      // count rides along so a list can show "empty" / reuse a draft.
      assert(!("messages" in summaries[0]!), "list() must not include messages");
      assertEquals(summaries[0]?.messageCount, 1, "message count is reported");
      assertEquals(summaries[0]?.agentId, "", "an explicitly empty agent id is preserved");
    });

    it("load returns the full conversation with messages", async () => {
      const store = makeStore();
      await store.save(conversation("a", 100));

      const full = await store.load("a");
      assertEquals(full?.id, "a");
      assertEquals(full?.messages.length, 1);
      assertEquals((full?.messages[0]?.parts[0] as { text: string }).text, "hello a");
    });

    it("load returns null for a missing id", async () => {
      assertEquals(await makeStore().load("nope"), null);
    });

    it("save is an upsert — same id updates, does not duplicate", async () => {
      const store = makeStore();
      await store.save(conversation("a", 100));
      await store.save(conversation("a", 300, { title: "Renamed", messages: [msg("again")] }));

      const summaries = await store.list();
      assertEquals(summaries.length, 1, "no duplicate entry");
      assertEquals(summaries[0]?.title, "Renamed");
      const full = await store.load("a");
      assertEquals((full?.messages[0]?.parts[0] as { text: string }).text, "again");
    });

    it("delete removes from list and load", async () => {
      const store = makeStore();
      await store.save(conversation("a", 100));
      await store.save(conversation("b", 200));

      await store.delete("a");
      assertEquals((await store.list()).map((s) => s.id), ["b"]);
      assertEquals(await store.load("a"), null);
    });

    it("delete is idempotent for a missing id", async () => {
      const store = makeStore();
      await store.delete("ghost"); // must not throw
      assertEquals(await store.list(), []);
    });

    it("snapshots save input at call time", async () => {
      const store = makeStore();
      const input = conversation("snapshot", 100);
      const save = store.save(input);

      input.title = "Mutated after save";
      input.messages[0]!.parts = [{ type: "text", text: "mutated" }];
      await save;

      const loaded = await store.load("snapshot");
      assertEquals(loaded?.title, "Conversation snapshot");
      assertEquals(
        (loaded?.messages[0]?.parts[0] as { text: string }).text,
        "hello snapshot",
      );
    });
  });
}

runContract("memory", () => memoryConversationStore());
runContract("local", () => testLocalConversationStore("test"));

describe("localConversationStore coordination", () => {
  it("keeps every storage access inside one logical-store lock", async () => {
    const names: string[] = [];
    let insideLock = false;
    const base = fakeStorage();
    const guardedStorage: StorageLike = {
      getItem(key) {
        assert(insideLock, `getItem(${key}) ran outside the lock`);
        return base.getItem(key);
      },
      setItem(key, value) {
        assert(insideLock, `setItem(${key}) ran outside the lock`);
        base.setItem(key, value);
      },
      removeItem(key) {
        assert(insideLock, `removeItem(${key}) ran outside the lock`);
        base.removeItem(key);
      },
    };
    const runner: ConversationStoreLockRunner = {
      async run<T>(
        name: string,
        criticalSection: () => T | PromiseLike<T>,
      ): Promise<T> {
        names.push(name);
        assertEquals(insideLock, false);
        insideLock = true;
        try {
          return await criticalSection();
        } finally {
          insideLock = false;
        }
      },
    };
    const store = testLocalConversationStore("coordinated", guardedStorage, runner);

    await store.save(conversation("a", 100));
    await store.list();
    await store.load("a");
    await store.delete("a");

    assertEquals(
      names,
      Array.from(
        { length: 4 },
        () => conversationStoreLockName("coordinated"),
      ),
    );
  });

  it("snapshots a save before waiting for the browser lock", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: ConversationStoreLockRunner = {
      async run<T>(
        _name: string,
        criticalSection: () => T | PromiseLike<T>,
      ): Promise<T> {
        await gate;
        return await criticalSection();
      },
    };
    const store = testLocalConversationStore("delayed-lock", fakeStorage(), runner);
    const input = conversation("snapshot", 100);

    const save = store.save(input);
    input.title = "Mutated while waiting";
    input.messages.length = 0;
    release();
    await save;

    assertEquals((await store.load("snapshot"))?.title, "Conversation snapshot");
  });

  it("normalizes lock acquisition failures with operation context", async () => {
    const cause = new Error("lock unavailable");
    const runner: ConversationStoreLockRunner = {
      run: () => Promise.reject(cause),
    };
    const store = testLocalConversationStore("lock-failure", fakeStorage(), runner);

    const error = await assertRejects(() => store.list(), ConversationStoreError);
    assertEquals((error as ConversationStoreError).operation, "list");
    assertEquals((error as ConversationStoreError).cause, cause);
  });
});

describe("memoryConversationStore isolation", () => {
  it("snapshots seeded conversations instead of retaining caller-owned objects", async () => {
    const seeded = conversation("seed", 100);
    const store = memoryConversationStore([seeded]);
    seeded.title = "Mutated outside the store";
    seeded.messages.length = 0;

    const loaded = await store.load("seed");
    assertEquals(loaded?.title, "Conversation seed");
    assertEquals(loaded?.messages.length, 1);
  });

  it("returns a rejected promise instead of throwing synchronously when cloning fails", async () => {
    const store = memoryConversationStore();
    const invalid = conversation("uncloneable", 100, {
      messages: [{
        id: "m-uncloneable",
        role: "user",
        parts: [{ type: "data-callback", data: () => undefined }],
      }],
    });

    const savePromise = store.save(invalid);
    assert(savePromise instanceof Promise);
    await assertRejects(() => savePromise);
  });

  it("rejects duplicate seeded ids instead of silently overwriting one", () => {
    assertThrows(
      () => memoryConversationStore([conversation("same", 100), conversation("same", 200)]),
      TypeError,
      "Duplicate seeded conversation id",
    );
  });
});

describe("localConversationStore crash recovery", () => {
  const savePhases = [
    { name: "journal write", ordinal: 1, committed: false },
    { name: "conversation write", ordinal: 2, committed: false },
    { name: "index write", ordinal: 3, committed: false },
    { name: "journal commit", ordinal: 4, committed: true },
  ] as const;

  for (const phase of savePhases) {
    it(`recovers a save interrupted after its ${phase.name}`, async () => {
      const storageKey = `save-interruption-${phase.ordinal}`;
      const base = fakeStorage();
      const oldConversation = conversation("a", 100);
      const updatedConversation = conversation("a", 200, {
        title: "Updated",
        agentId: "updated-agent",
        messages: [msg("updated one"), msg("updated two")],
      });
      await testLocalConversationStore(storageKey, base).save(oldConversation);

      const interrupted = testLocalConversationStore(
        storageKey,
        interruptAfterMutation(base, phase.ordinal),
      );
      await assertRejects(
        () => interrupted.save(updatedConversation),
        ConversationStoreError,
      );

      const recovered = testLocalConversationStore(storageKey, base);
      const summaries = await recovered.list();
      const expected = phase.committed ? updatedConversation : oldConversation;
      assertEquals(summaries.map((item) => item.id), ["a"]);
      assertEquals(summaries[0]?.title, expected.title);
      assertEquals(summaries[0]?.agentId, expected.agentId);
      assertEquals(summaries[0]?.updatedAt, expected.updatedAt);
      assertEquals(summaries[0]?.messageCount, expected.messages.length);
      assertEquals(await recovered.load("a"), expected);
      assertTransactionReservation(base, storageKey);
    });
  }

  it("removes both orphaned keys when a first save stops between writes", async () => {
    const storageKey = "first-save-interruption";
    const base = fakeStorage();
    const interrupted = testLocalConversationStore(
      storageKey,
      interruptAfterMutation(base, 3),
    );

    await assertRejects(
      () => interrupted.save(conversation("new", 100)),
      ConversationStoreError,
    );

    const recovered = testLocalConversationStore(storageKey, base);
    assertEquals(await recovered.list(), []);
    assertEquals(await recovered.load("new"), null);
    assertEquals(base.getItem(conversationIndexStorageKey(storageKey)), null);
    assertEquals(base.getItem(conversationBlobStorageKey(storageKey, "new")), null);
    assertTransactionReservation(base, storageKey);
  });

  const deletePhases = [
    { name: "intent write", ordinal: 1 },
    { name: "conversation removal", ordinal: 2 },
    { name: "index write", ordinal: 3 },
    { name: "reservation commit", ordinal: 4 },
  ] as const;

  for (const phase of deletePhases) {
    it(`recovers a current-record delete interrupted after its ${phase.name}`, async () => {
      const storageKey = `delete-interruption-${phase.ordinal}`;
      const base = fakeStorage();
      await testLocalConversationStore(storageKey, base).save(conversation("a", 100));

      const interrupted = testLocalConversationStore(
        storageKey,
        interruptAfterMutation(base, phase.ordinal),
      );
      await assertRejects(() => interrupted.delete("a"), ConversationStoreError);

      const recovered = testLocalConversationStore(storageKey, base);
      assertEquals(
        (await recovered.list()).map((item) => item.id),
        [],
      );
      assertEquals(await recovered.load("a"), null);
      assertTransactionReservation(base, storageKey);
    });
  }

  const legacyDeletePhases = [
    { name: "intent write", ordinal: 1 },
    { name: "legacy-record removal", ordinal: 2 },
    { name: "tombstone write", ordinal: 3 },
    { name: "reservation commit", ordinal: 4 },
  ] as const;

  for (const phase of legacyDeletePhases) {
    it(`recovers a legacy delete interrupted after its ${phase.name}`, async () => {
      const storageKey = `legacy-delete-interruption-${phase.ordinal}`;
      const id = "legacy";
      const base = fakeStorage();
      const legacyConversation = conversation(id, 100);
      base.setItem(
        legacyConversationIndexStorageKey(storageKey),
        JSON.stringify([{
          id,
          title: legacyConversation.title,
          messageCount: legacyConversation.messages.length,
          createdAt: legacyConversation.createdAt,
          updatedAt: legacyConversation.updatedAt,
        }]),
      );
      base.setItem(
        legacyConversationBlobStorageKey(storageKey, id),
        JSON.stringify(legacyConversation),
      );

      const interrupted = testLocalConversationStore(
        storageKey,
        interruptAfterMutation(base, phase.ordinal),
      );
      await assertRejects(() => interrupted.delete(id), ConversationStoreError);

      const recovered = testLocalConversationStore(storageKey, base);
      assertEquals(
        (await recovered.list()).map((item) => item.id),
        [],
      );
      assertEquals(await recovered.load(id), null);
      assertTransactionReservation(base, storageKey);
    });
  }

  const currentAndLegacyDeletePhases = [
    { name: "intent write", ordinal: 1 },
    { name: "current-record removal", ordinal: 2 },
    { name: "legacy-record removal", ordinal: 3 },
    { name: "index write", ordinal: 4 },
    { name: "reservation commit", ordinal: 5 },
  ] as const;

  for (const phase of currentAndLegacyDeletePhases) {
    it(`recovers a mixed-layout delete interrupted after its ${phase.name}`, async () => {
      const storageKey = `mixed-delete-interruption-${phase.ordinal}`;
      const id = "mixed";
      const base = fakeStorage();
      await testLocalConversationStore(storageKey, base).save(conversation(id, 100));
      const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
      base.setItem(legacyBlobKey, JSON.stringify(conversation(id, 50)));

      const interrupted = testLocalConversationStore(
        storageKey,
        interruptAfterMutation(base, phase.ordinal),
      );
      await assertRejects(() => interrupted.delete(id), ConversationStoreError);

      const recovered = testLocalConversationStore(storageKey, base);
      assertEquals(await recovered.load(id), null);
      assertEquals(await recovered.list(), []);
      assertEquals(base.getItem(legacyBlobKey), null);
      assertTransactionReservation(base, storageKey);
    });
  }

  for (
    const invalid of [
      { name: "malformed", raw: "{not-json" },
      {
        name: "foreign",
        raw: transactionJournalRaw("foreign-namespace", "a"),
      },
      {
        name: "unexpected-field",
        raw: transactionJournalRaw("invalid-journal", "a", { extra: true }),
      },
      {
        name: "malformed-current-before-image",
        raw: transactionJournalRaw("invalid-journal", "a", {
          previous: { index: null, currentBlob: "{not-json" },
        }),
      },
      {
        name: "mismatched-current-before-image",
        raw: transactionJournalRaw("invalid-journal", "a", {
          previous: {
            index: null,
            currentBlob: JSON.stringify(conversation("different-id", 100)),
          },
        }),
      },
      {
        name: "undersized-delete-intent",
        raw: JSON.stringify({
          format: CONVERSATION_STORAGE_FORMAT,
          version: CONVERSATION_STORAGE_VERSION,
          kind: "transaction-journal",
          storageKey: "invalid-journal",
          operation: "delete",
          id: "a",
          ensureCurrentIndex: true,
          padding: "",
        }),
      },
    ]
  ) {
    it(`fails closed without altering data for a ${invalid.name} journal`, async () => {
      const storageKey = "invalid-journal";
      const base = fakeStorage();
      const store = testLocalConversationStore(storageKey, base);
      await store.save(conversation("a", 100));
      const indexKey = conversationIndexStorageKey(storageKey);
      const blobKey = conversationBlobStorageKey(storageKey, "a");
      const journalKey = conversationTransactionJournalStorageKey(storageKey);
      const indexBefore = base.getItem(indexKey);
      const blobBefore = base.getItem(blobKey);
      base.setItem(journalKey, invalid.raw);

      const error = await assertRejects(
        () => store.list(),
        ConversationStoreError,
      ) as ConversationStoreError;
      assertEquals(error.operation, "list");
      assert(error.cause instanceof Error);
      assertEquals(base.getItem(journalKey), invalid.raw);
      assertEquals(base.getItem(indexKey), indexBefore);
      assertEquals(base.getItem(blobKey), blobBefore);

      base.removeItem(journalKey);
      assertEquals((await store.load("a"))?.id, "a");
    });
  }

  it("retains a failed recovery journal and reports the exact storage failure", async () => {
    const storageKey = "recovery-failure";
    const id = "a";
    const base = fakeStorage();
    const oldConversation = conversation(id, 100);
    await testLocalConversationStore(storageKey, base).save(oldConversation);
    await assertRejects(
      () =>
        testLocalConversationStore(storageKey, interruptAfterMutation(base, 2)).save(
          conversation(id, 200, { title: "Interrupted update" }),
        ),
      ConversationStoreError,
    );

    const journalKey = conversationTransactionJournalStorageKey(storageKey);
    const interruptedJournal = base.getItem(journalKey);
    assert(interruptedJournal !== null);
    const blobKey = conversationBlobStorageKey(storageKey, id);
    const recoveryFailure = new Error("recovery write blocked");
    let blockRecovery = true;
    const recoveringStorage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        if (blockRecovery && key === blobKey) throw recoveryFailure;
        base.setItem(key, value);
      },
      removeItem: (key) => base.removeItem(key),
    };
    const recoveringStore = testLocalConversationStore(storageKey, recoveringStorage);

    const error = await assertRejects(
      () => recoveringStore.list(),
      ConversationStoreError,
    ) as ConversationStoreError;
    assert(error.cause instanceof AggregateError);
    assert((error.cause as AggregateError).errors.includes(recoveryFailure));
    assertEquals(base.getItem(journalKey), interruptedJournal);

    blockRecovery = false;
    assertEquals((await recoveringStore.load(id))?.title, oldConversation.title);
    assertTransactionReservation(base, storageKey);
  });

  it("preserves an AggregateError thrown by storage during recovery", async () => {
    const storageKey = "aggregate-recovery-failure";
    const id = "a";
    const base = fakeStorage();
    const primary = new Error("primary index failure");
    const recovery = new AggregateError(
      [new Error("storage detail")],
      "storage recovery read failed",
    );
    const indexKey = conversationIndexStorageKey(storageKey);
    const journalKey = conversationTransactionJournalStorageKey(storageKey);
    let failUpdate = false;
    let failRecoveryRead = false;
    const storage: StorageLike = {
      getItem(key) {
        if (failRecoveryRead && key === journalKey) throw recovery;
        return base.getItem(key);
      },
      setItem(key, value) {
        base.setItem(key, value);
        if (failUpdate && key === indexKey) {
          failRecoveryRead = true;
          throw primary;
        }
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100));
    failUpdate = true;

    const error = await assertRejects(
      () => store.save(conversation(id, 200, { title: "Interrupted update" })),
      ConversationStoreError,
    ) as ConversationStoreError;
    assert(error.cause instanceof AggregateError);
    assertEquals((error.cause as AggregateError).errors, [primary, recovery]);
    assertEquals(base.getItem(journalKey) === null, false);

    failUpdate = false;
    failRecoveryRead = false;
    assertEquals((await store.load(id))?.title, `Conversation ${id}`);
    assertTransactionReservation(base, storageKey);
  });
});

describe("localConversationStore failures", () => {
  it("rejects instead of claiming persistence when browser capabilities are unavailable", async () => {
    const store = localConversationStore("unavailable-default");

    const error = await assertRejects(() => store.list(), ConversationStoreError);
    assertEquals((error as ConversationStoreError).operation, "list");
  });

  it("rejects corrupt indexes and conversation blobs explicitly", async () => {
    const storage = fakeStorage();
    const store = testLocalConversationStore("corrupt", storage);
    storage.setItem("corrupt-index", "{not-json");

    const listError = await assertRejects(() => store.list(), ConversationStoreError);
    assertEquals((listError as ConversationStoreError).operation, "list");

    storage.setItem(
      "corrupt-index",
      JSON.stringify([{
        id: "broken",
        title: "Broken",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
      }]),
    );
    storage.setItem("corrupt-broken", JSON.stringify({ id: "broken" }));
    const loadError = await assertRejects(
      () => store.load("broken"),
      ConversationStoreError,
    );
    assertEquals((loadError as ConversationStoreError).operation, "load");

    storage.setItem(
      "corrupt-index",
      JSON.stringify([{
        id: "mismatch",
        title: "Mismatch",
        messageCount: 0,
        createdAt: 1,
        updatedAt: 1,
      }]),
    );
    storage.setItem(
      "corrupt-mismatch",
      JSON.stringify(conversation("different-id", 100)),
    );
    await assertRejects(
      () => store.load("mismatch"),
      ConversationStoreError,
    );

    storage.setItem("corrupt-index", "[]");
    storage.setItem("corrupt-unlisted", "{not-json");
    assertEquals(await store.load("unlisted"), null);
  });

  it("rejects invalid writes before they can corrupt storage", async () => {
    const storage = fakeStorage();
    const store = testLocalConversationStore("invalid-write", storage);

    const error = await assertRejects(
      () => store.save(conversation("a", 100, { updatedAt: Number.NaN })),
      ConversationStoreError,
    );
    assertEquals((error as ConversationStoreError).operation, "save");
    assertEquals(storage.getItem(conversationBlobStorageKey("invalid-write", "a")), null);
    assertEquals(await store.list(), []);
  });

  it('persists the formerly-colliding id "index" without overwriting the index', async () => {
    const storage = fakeStorage();
    const store = testLocalConversationStore("collision", storage);

    await store.save(conversation("index", 100));

    assertEquals((await store.load("index"))?.id, "index");
    assertEquals((await store.list()).map((summary) => summary.id), ["index"]);
    assert(storage.getItem(conversationIndexStorageKey("collision")) !== null);
    assert(storage.getItem(conversationBlobStorageKey("collision", "index")) !== null);
  });

  it("uses reserved headroom to delete a current record at exact quota", async () => {
    const storageKey = "\0".repeat(
      CONVERSATION_STORAGE_LIMITS.maxStorageKeyComponentBytes,
    );
    const id = "\0".repeat(CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes);
    const storage = quotaStorage();
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100, {
      messages: [{
        id: "large-message",
        role: "user",
        parts: [{ type: "text", text: "x".repeat(200_000) }],
      }] as ChatMessage[],
    }));
    const before = storage.usage();
    storage.setQuota(before);

    await store.delete(id);

    assert(storage.usage() < before);
    assertEquals(await store.load(id), null);
    assertEquals(await store.list(), []);
    assertTransactionReservation(storage, storageKey);
  });

  it("uses reserved headroom for an unindexed current record at exact quota", async () => {
    const storageKey = "\0".repeat(
      CONVERSATION_STORAGE_LIMITS.maxStorageKeyComponentBytes,
    );
    const id = "\0".repeat(CONVERSATION_STORAGE_LIMITS.maxIdentifierBytes);
    const storage = quotaStorage();
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100, {
      messages: [{
        id: "short-message",
        role: "user",
        parts: [{ type: "text", text: "content" }],
      }] as ChatMessage[],
    }));
    storage.removeItem(conversationIndexStorageKey(storageKey));
    const before = storage.usage();
    storage.setQuota(before);

    await store.delete(id);

    assert(storage.usage() < before);
    assertEquals(await store.load(id), null);
    assertEquals(await store.list(), []);
    assertTransactionReservation(storage, storageKey);
  });

  it("does not mutate an unreserved legacy record when delete intent allocation hits quota", async () => {
    const storageKey = "legacy-delete-at-quota";
    const id = "legacy";
    const storage = quotaStorage();
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
    const record = conversation(id, 100);
    const legacyIndex = JSON.stringify([{
      id,
      title: record.title,
      messageCount: record.messages.length,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }]);
    const legacyBlob = JSON.stringify(record);
    storage.setItem(legacyIndexKey, legacyIndex);
    storage.setItem(legacyBlobKey, legacyBlob);
    storage.setQuota(storage.usage());
    const store = testLocalConversationStore(storageKey, storage);

    const error = await assertRejects(
      () => store.delete(id),
      ConversationStoreError,
    ) as ConversationStoreError;
    assertEquals(error.cause, storage.quotaError);
    assertEquals(storage.getItem(legacyIndexKey), legacyIndex);
    assertEquals(storage.getItem(legacyBlobKey), legacyBlob);
    assertEquals(
      storage.getItem(conversationTransactionJournalStorageKey(storageKey)),
      null,
    );
  });

  it("rejects an oversized legacy tombstone before making deletion durable", async () => {
    const storageKey = "legacy-tombstone-boundary";
    const id = "a";
    const storage = fakeStorage();
    const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    const currentIndexKey = conversationIndexStorageKey(storageKey);
    const journalKey = conversationTransactionJournalStorageKey(storageKey);
    const summaries = Array.from({ length: 129 }, (_, index) => ({
      id: index === 0 ? id : `filler-${index}`,
      title: "",
      messageCount: 0,
      createdAt: index,
      updatedAt: index,
    }));
    let remainingBytes = CONVERSATION_STORAGE_LIMITS.maxIndexBytes -
      JSON.stringify(summaries).length;
    for (let index = 1; index < summaries.length && remainingBytes > 0; index += 1) {
      const titleBytes = Math.min(
        remainingBytes,
        CONVERSATION_STORAGE_LIMITS.maxTitleBytes,
      );
      summaries[index]!.title = "x".repeat(titleBytes);
      remainingBytes -= titleBytes;
    }
    assertEquals(remainingBytes, 0, "the fixture must fill the legacy index bound exactly");
    const legacyIndex = JSON.stringify(summaries);
    assertEquals(
      new TextEncoder().encode(legacyIndex).byteLength,
      CONVERSATION_STORAGE_LIMITS.maxIndexBytes,
    );
    const legacyBlob = JSON.stringify(conversation(id, 100));
    storage.setItem(legacyIndexKey, legacyIndex);
    storage.setItem(legacyBlobKey, legacyBlob);
    const store = testLocalConversationStore(storageKey, storage);

    const error = await assertRejects(
      () => store.delete(id),
      ConversationStoreError,
    ) as ConversationStoreError;

    assert(error.cause instanceof TypeError);
    assertEquals(storage.getItem(legacyIndexKey), legacyIndex);
    assertEquals(storage.getItem(legacyBlobKey), legacyBlob);
    assertEquals(storage.getItem(currentIndexKey), null);
    assertEquals(storage.getItem(journalKey), null);
    assertEquals((await store.load(id))?.id, id);
  });

  it('preserves the ambiguous legacy index key while deleting current id "index"', async () => {
    const storageKey = "ambiguous-index-delete";
    const id = "index";
    const storage = fakeStorage();
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100));
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    const legacyIndex = JSON.stringify([]);
    assertEquals(legacyIndexKey, legacyConversationBlobStorageKey(storageKey, id));
    storage.setItem(legacyIndexKey, legacyIndex);

    await store.delete(id);

    assertEquals(storage.getItem(legacyIndexKey), legacyIndex);
    assertEquals(await store.load(id), null);
  });

  it("preserves an unattributable corrupt legacy value while deleting the current record", async () => {
    const storageKey = "corrupt-legacy-delete";
    const id = "a";
    const storage = fakeStorage();
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100));
    const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
    storage.setItem(legacyBlobKey, "{not-json");

    await store.delete(id);

    assertEquals(storage.getItem(legacyBlobKey), "{not-json");
    assertEquals(await store.load(id), null);
  });

  it("retains a save journal until the idle reservation can be restored", async () => {
    const storageKey = "reservation-retry";
    const base = fakeStorage();
    const journalKey = conversationTransactionJournalStorageKey(storageKey);
    const reservationFailure = new Error("reservation write blocked");
    let blockReservation = true;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem(key, value) {
        if (
          blockReservation &&
          key === journalKey &&
          value.startsWith("veryfront.conversation-store.transaction-reservation.v1")
        ) {
          throw reservationFailure;
        }
        base.setItem(key, value);
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore(storageKey, storage);

    const error = await assertRejects(
      () => store.save(conversation("a", 100)),
      ConversationStoreError,
    ) as ConversationStoreError;
    assert(error.cause instanceof AggregateError);
    assertEquals(
      (error.cause as AggregateError).errors,
      [reservationFailure, reservationFailure],
    );
    assert(base.getItem(journalKey)?.includes('"operation":"save"'));
    assertEquals(base.getItem(conversationBlobStorageKey(storageKey, "a")), null);
    assertEquals(base.getItem(conversationIndexStorageKey(storageKey)), null);

    blockReservation = false;
    assertEquals(await store.list(), []);
    assertTransactionReservation(base, storageKey);
  });

  it("recovers a pending delete before a same-id save writes its replacement", async () => {
    const storageKey = "delete-then-save";
    const id = "a";
    const base = fakeStorage();
    const blobKey = conversationBlobStorageKey(storageKey, id);
    const blocked = new Error("delete blocked");
    let blockRemove = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => base.setItem(key, value),
      removeItem(key) {
        if (blockRemove && key === blobKey) throw blocked;
        base.removeItem(key);
      },
    };
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100));
    blockRemove = true;
    await assertRejects(() => store.delete(id), ConversationStoreError);

    blockRemove = false;
    await store.save(conversation(id, 200, { title: "Replacement" }));

    assertEquals((await store.load(id))?.title, "Replacement");
    assertEquals((await store.list())[0]?.title, "Replacement");
    assertTransactionReservation(base, storageKey);
  });

  it("rejects quota failures and rolls back the conversation blob", async () => {
    const base = fakeStorage();
    const indexKey = conversationIndexStorageKey("quota");
    let rejectIndexWrite = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (rejectIndexWrite && key === indexKey) throw new Error("quota exceeded");
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore("quota", storage);
    await store.save(conversation("a", 100));
    rejectIndexWrite = true;

    const error = await assertRejects(
      () => store.save(conversation("a", 200, { title: "Not persisted" })),
      ConversationStoreError,
    );
    assertEquals((error as ConversationStoreError).operation, "save");
    assertEquals((await store.load("a"))?.title, "Conversation a");
    assertEquals((await store.list())[0]?.title, "Conversation a");
  });

  it("finishes deletion when the index write reports failure after applying", async () => {
    const base = fakeStorage();
    const indexKey = conversationIndexStorageKey("delete");
    const primary = new Error("blocked");
    let rejectIndexWrite = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (rejectIndexWrite && key === indexKey) throw primary;
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore("delete", storage);
    await store.save(conversation("a", 100));
    rejectIndexWrite = true;

    const error = await assertRejects(
      () => store.delete("a"),
      ConversationStoreError,
    ) as ConversationStoreError;

    assertEquals(error.cause, primary);
    assertEquals(await store.load("a"), null);
    assertEquals(await store.list(), []);
    assertTransactionReservation(base, "delete");
  });

  it("does not roll back a colliding legacy key that the delete did not own", async () => {
    const base = fakeStorage();
    const localStoreKey = "tenant-region";
    const localId = "thread";
    const foreignStoreKey = "tenant";
    const foreignId = "region-thread";
    const localIndexKey = conversationIndexStorageKey(localStoreKey);
    const collidingLegacyKey = legacyConversationBlobStorageKey(localStoreKey, localId);
    assertEquals(
      collidingLegacyKey,
      legacyConversationBlobStorageKey(foreignStoreKey, foreignId),
    );
    const previousForeign = JSON.stringify(conversation(foreignId, 100));
    const concurrentForeign = JSON.stringify(
      conversation(foreignId, 200, { title: "Concurrent foreign update" }),
    );
    const primary = new Error("local index write failed");
    let failDelete = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (!failDelete || key !== localIndexKey) return;
        failDelete = false;
        base.setItem(collidingLegacyKey, concurrentForeign);
        throw primary;
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore(localStoreKey, storage);
    await store.save(conversation(localId, 100));
    base.setItem(collidingLegacyKey, previousForeign);
    failDelete = true;

    const error = await assertRejects(
      () => store.delete(localId),
      ConversationStoreError,
    ) as ConversationStoreError;

    assertEquals(error.cause, primary);
    assertEquals(base.getItem(collidingLegacyKey), concurrentForeign);
    assertEquals(await store.load(localId), null);
  });

  it("finishes deletion when the first removal reports failure after applying", async () => {
    const base = fakeStorage();
    const blobKey = conversationBlobStorageKey("remove-failure", "a");
    const primary = new Error("remove blocked");
    let failRemove = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => base.setItem(key, value),
      removeItem: (key) => {
        base.removeItem(key);
        if (failRemove && key === blobKey) throw primary;
      },
    };
    const store = testLocalConversationStore("remove-failure", storage);
    await store.save(conversation("a", 100));
    failRemove = true;

    const error = await assertRejects(
      () => store.delete("a"),
      ConversationStoreError,
    ) as ConversationStoreError;

    assertEquals(error.cause, primary);
    assertEquals(await store.load("a"), null);
    assertEquals(await store.list(), []);
    assertTransactionReservation(base, "remove-failure");
  });

  it("retains a delete intent until a blocked removal can be retried", async () => {
    const storageKey = "blocked-delete-retry";
    const id = "a";
    const base = fakeStorage();
    const blobKey = conversationBlobStorageKey(storageKey, id);
    const blocked = new Error("remove blocked before applying");
    let blockRemove = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => base.setItem(key, value),
      removeItem(key) {
        if (blockRemove && key === blobKey) throw blocked;
        base.removeItem(key);
      },
    };
    const store = testLocalConversationStore(storageKey, storage);
    await store.save(conversation(id, 100));
    blockRemove = true;

    const error = await assertRejects(
      () => store.delete(id),
      ConversationStoreError,
    ) as ConversationStoreError;
    assert(error.cause instanceof AggregateError);
    assert((error.cause as AggregateError).errors.includes(blocked));
    const pending = base.getItem(conversationTransactionJournalStorageKey(storageKey));
    assert(pending?.includes('"operation":"delete"'));
    assert(base.getItem(blobKey) !== null);

    blockRemove = false;
    assertEquals(await store.load(id), null);
    assertTransactionReservation(base, storageKey);
  });

  it("preserves a legacy removal failure until recovery can retry it", async () => {
    const storageKey = "blocked-legacy-delete-retry";
    const id = "legacy";
    const base = fakeStorage();
    const legacyBlobKey = legacyConversationBlobStorageKey(storageKey, id);
    const legacyIndexKey = legacyConversationIndexStorageKey(storageKey);
    const blocked = new Error("legacy remove blocked before applying");
    let blockRemove = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => base.setItem(key, value),
      removeItem(key) {
        if (blockRemove && key === legacyBlobKey) throw blocked;
        base.removeItem(key);
      },
    };
    const record = conversation(id, 100);
    base.setItem(legacyBlobKey, JSON.stringify(record));
    base.setItem(
      legacyIndexKey,
      JSON.stringify([{
        id,
        title: record.title,
        messageCount: record.messages.length,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }]),
    );
    const store = testLocalConversationStore(storageKey, storage);
    blockRemove = true;

    const error = await assertRejects(
      () => store.delete(id),
      ConversationStoreError,
    ) as ConversationStoreError;

    assert(error.cause instanceof AggregateError);
    assertEquals((error.cause as AggregateError).errors, [blocked, blocked]);
    assert(base.getItem(legacyBlobKey) !== null);
    assert(
      base.getItem(conversationTransactionJournalStorageKey(storageKey))?.includes(
        '"operation":"delete"',
      ),
    );

    blockRemove = false;
    assertEquals(await store.load(id), null);
    assertTransactionReservation(base, storageKey);
  });

  it("retains the primary and rollback failures for diagnosis", async () => {
    const base = fakeStorage();
    const indexKey = conversationIndexStorageKey("rollback-failure");
    const primary = new Error("primary index failure");
    const rollback = new Error("rollback index failure");
    let failingIndexWrites = 0;
    let fail = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (!fail || key !== indexKey) return;
        failingIndexWrites += 1;
        throw failingIndexWrites === 1 ? primary : rollback;
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore("rollback-failure", storage);
    await store.save(conversation("a", 100));
    fail = true;

    const error = await assertRejects(
      () => store.save(conversation("a", 200)),
      ConversationStoreError,
    ) as ConversationStoreError;
    assertEquals(error.operation, "save");
    assert(error.cause instanceof AggregateError);
    assertEquals((error.cause as AggregateError).errors, [primary, rollback]);
    assert(
      base.getItem(conversationTransactionJournalStorageKey("rollback-failure")) !== null,
    );

    assertEquals((await store.load("a"))?.title, "Conversation a");
    assertEquals(
      base.getItem(conversationTransactionJournalStorageKey("rollback-failure"))?.startsWith(
        "veryfront.conversation-store.transaction-reservation.v1",
      ),
      true,
    );
  });
});
