import { assertEquals, assertRejects } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { type RedisClient, RedisMemory } from "./redis.ts";

/** Minimal in-memory RedisClient honoring the get/set/del/expire contract. */
function createFakeRedis(): RedisClient & { store: Map<string, string>; lastEx?: number } {
  const store = new Map<string, string>();
  const fake = {
    store,
    lastEx: undefined as number | undefined,
    get(key: string): Promise<string | null> {
      return Promise.resolve(store.has(key) ? store.get(key)! : null);
    },
    set(key: string, value: string, options?: { EX?: number }): Promise<unknown> {
      store.set(key, value);
      fake.lastEx = options?.EX;
      return Promise.resolve("OK");
    },
    del(key: string): Promise<number> {
      const existed = store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    },
    expire(_key: string, _seconds: number): Promise<number> {
      return Promise.resolve(1);
    },
  };
  return fake;
}

type Msg = { role: string; content: string };

describe("agent/memory/redis", () => {
  it("round-trips messages through add() and getMessages()", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("agent-1", { type: "redis", client });

    await memory.add({ role: "user", content: "hello" });
    await memory.add({ role: "assistant", content: "hi there" });

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages[0].content, "hello");
    assertEquals(messages[1].content, "hi there");
  });

  it("returns an empty list when no data is stored", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("empty", { type: "redis", client });
    assertEquals(await memory.getMessages(), []);
  });

  it("enforces maxMessages by keeping the most recent", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("cap", { type: "redis", client, maxMessages: 2 });

    await memory.add({ role: "user", content: "1" });
    await memory.add({ role: "user", content: "2" });
    await memory.add({ role: "user", content: "3" });

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.map((m) => m.content), ["2", "3"]);
  });

  it("sets an EX TTL when ttl > 0 and omits it when ttl <= 0", async () => {
    const withTtl = createFakeRedis();
    await new RedisMemory<Msg>("ttl", { type: "redis", client: withTtl, ttl: 60 })
      .add({ role: "user", content: "x" });
    assertEquals(withTtl.lastEx, 60);

    const noTtl = createFakeRedis();
    await new RedisMemory<Msg>("no-ttl", { type: "redis", client: noTtl, ttl: 0 })
      .add({ role: "user", content: "x" });
    assertEquals(noTtl.lastEx, undefined);
  });

  it("clear() deletes the stored key", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("del", { type: "redis", client });
    await memory.add({ role: "user", content: "x" });
    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });

  it("namespaces keys by prefix, agentId, and userId", async () => {
    const client = createFakeRedis();
    const a = new RedisMemory<Msg>("agentA", { type: "redis", client, userId: "u1" });
    const b = new RedisMemory<Msg>("agentB", { type: "redis", client, userId: "u2" });
    await a.add({ role: "user", content: "for-a" });
    assertEquals((await b.getMessages()).length, 0);
    assertEquals((await a.getMessages())[0].content, "for-a");
  });

  it("throws on corrupt JSON instead of silently wiping history", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("corrupt", { type: "redis", client });
    // Seed the key with invalid JSON directly, then a read/add must surface it.
    client.store.set("veryfront:agent:memory:corrupt:anonymous", "{not valid json");

    await assertRejects(() => memory.getMessages());
    await assertRejects(() => memory.add({ role: "user", content: "x" }));
    // The corrupt value must NOT have been overwritten by add().
    assertEquals(client.store.get("veryfront:agent:memory:corrupt:anonymous"), "{not valid json");
  });
});
