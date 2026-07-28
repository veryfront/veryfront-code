import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import {
  conversationBlobStorageKey,
  conversationIndexStorageKey,
  legacyConversationBlobStorageKey,
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

  it("rejects delete failures without losing the stored conversation", async () => {
    const base = fakeStorage();
    const indexKey = conversationIndexStorageKey("delete");
    let rejectIndexWrite = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (rejectIndexWrite && key === indexKey) throw new Error("blocked");
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore("delete", storage);
    await store.save(conversation("a", 100));
    rejectIndexWrite = true;

    const error = await assertRejects(() => store.delete("a"), ConversationStoreError);
    assertEquals((error as ConversationStoreError).operation, "delete");
    assertEquals((await store.load("a"))?.id, "a");
    assertEquals((await store.list()).map((summary) => summary.id), ["a"]);
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
    let failDelete = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => {
        base.setItem(key, value);
        if (!failDelete || key !== localIndexKey) return;
        failDelete = false;
        base.setItem(collidingLegacyKey, concurrentForeign);
        throw new Error("local index write failed");
      },
      removeItem: (key) => base.removeItem(key),
    };
    const store = testLocalConversationStore(localStoreKey, storage);
    await store.save(conversation(localId, 100));
    base.setItem(collidingLegacyKey, previousForeign);
    failDelete = true;

    await assertRejects(() => store.delete(localId), ConversationStoreError);

    assertEquals(base.getItem(collidingLegacyKey), concurrentForeign);
  });

  it("rolls back when the first delete mutation throws after changing storage", async () => {
    const base = fakeStorage();
    const blobKey = conversationBlobStorageKey("remove-failure", "a");
    let failRemove = false;
    const storage: StorageLike = {
      getItem: (key) => base.getItem(key),
      setItem: (key, value) => base.setItem(key, value),
      removeItem: (key) => {
        base.removeItem(key);
        if (failRemove && key === blobKey) throw new Error("remove blocked");
      },
    };
    const store = testLocalConversationStore("remove-failure", storage);
    await store.save(conversation("a", 100));
    failRemove = true;

    const error = await assertRejects(() => store.delete("a"), ConversationStoreError);
    assertEquals((error as ConversationStoreError).operation, "delete");
    assertEquals((await store.load("a"))?.id, "a");
    assertEquals((await store.list()).map((summary) => summary.id), ["a"]);
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
  });
});
