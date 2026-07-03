import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatMessage } from "#veryfront/agent/react";
import type { Conversation, ConversationStore } from "./conversation-store.ts";
import { localConversationStore, type StorageLike } from "./local-conversation-store.ts";
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

// One contract, run against every adapter — the whole point of the abstraction.
function runContract(name: string, makeStore: () => ConversationStore): void {
  describe(`ConversationStore contract — ${name}`, () => {
    it("starts empty", async () => {
      assertEquals(await makeStore().list(), []);
    });

    it("save then list returns summaries (newest first, no messages)", async () => {
      const store = makeStore();
      await store.save(conversation("a", 100));
      await store.save(conversation("b", 200));

      const summaries = await store.list();
      assertEquals(summaries.map((s) => s.id), ["b", "a"], "newest updatedAt first");
      // Summaries are lightweight — no messages hauled for the list.
      assert(!("messages" in summaries[0]!), "list() must not include messages");
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
  });
}

runContract("memory", () => memoryConversationStore());
runContract("local", () => localConversationStore("test", fakeStorage()));
