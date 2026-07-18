import { assertEquals, assertRejects } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import type { MinimalMessage } from "./memory-interface.ts";
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
    eval(
      _script: string,
      options: { keys: string[]; arguments: string[] },
    ): Promise<unknown> {
      const key = options.keys[0]!;
      const [messageJson = "{}", maxMessagesRaw = "0", maxTokensRaw = "0", ttlRaw = "0"] =
        options.arguments;
      const current = store.get(key);
      let messages = current ? JSON.parse(current) as Msg[] : [];
      messages.push(JSON.parse(messageJson) as Msg);

      const maxMessages = Number(maxMessagesRaw);
      if (maxMessages > 0 && messages.length > maxMessages) {
        messages = messages.slice(-maxMessages);
      }

      const maxTokens = Number(maxTokensRaw);
      while (maxTokens > 0 && messages.length > 1 && estimateTestTokens(messages) > maxTokens) {
        messages.shift();
      }

      const ttl = Number(ttlRaw);
      fake.lastEx = ttl > 0 ? ttl : undefined;
      store.set(key, JSON.stringify(messages));
      return Promise.resolve(messages.length);
    },
  };
  return fake;
}

type Msg = Omit<MinimalMessage, "parts"> & {
  content: string;
  parts: Array<{ type: "text"; text: string }>;
};

let nextMessageId = 0;

function msg(role: Msg["role"], content: string): Msg {
  nextMessageId++;
  return {
    id: `msg-${nextMessageId}`,
    role,
    content,
    parts: [{ type: "text", text: content }],
  };
}

function estimateTestTokens(messages: Msg[]): number {
  const totalChars = messages.reduce(
    (sum, message) => sum + message.parts.reduce((partSum, part) => partSum + part.text.length, 0),
    0,
  );
  return Math.ceil(totalChars / 4);
}

describe("agent/memory/redis", () => {
  it("round-trips messages through add() and getMessages()", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("agent-1", { type: "redis", client });

    await memory.add(msg("user", "hello"));
    await memory.add(msg("assistant", "hi there"));

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages[0]?.content, "hello");
    assertEquals(messages[1]?.content, "hi there");
  });

  it("returns an empty list when no data is stored", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("empty", { type: "redis", client });
    assertEquals(await memory.getMessages(), []);
  });

  it("enforces maxMessages by keeping the most recent", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("cap", { type: "redis", client, maxMessages: 2 });

    await memory.add(msg("user", "1"));
    await memory.add(msg("user", "2"));
    await memory.add(msg("user", "3"));

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.map((m) => m.content), ["2", "3"]);
  });

  it("sets an EX TTL when ttl > 0 and omits it when ttl <= 0", async () => {
    const withTtl = createFakeRedis();
    await new RedisMemory<Msg>("ttl", { type: "redis", client: withTtl, ttl: 60 })
      .add(msg("user", "x"));
    assertEquals(withTtl.lastEx, 60);

    const noTtl = createFakeRedis();
    await new RedisMemory<Msg>("no-ttl", { type: "redis", client: noTtl, ttl: 0 })
      .add(msg("user", "x"));
    assertEquals(noTtl.lastEx, undefined);
  });

  it("clear() deletes the stored key", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("del", { type: "redis", client });
    await memory.add(msg("user", "x"));
    await memory.clear();
    assertEquals(await memory.getMessages(), []);
  });

  it("namespaces keys by prefix, agentId, and userId", async () => {
    const client = createFakeRedis();
    const a = new RedisMemory<Msg>("agentA", { type: "redis", client, userId: "u1" });
    const b = new RedisMemory<Msg>("agentB", { type: "redis", client, userId: "u2" });
    await a.add(msg("user", "for-a"));
    assertEquals((await b.getMessages()).length, 0);
    assertEquals((await a.getMessages())[0]?.content, "for-a");
  });

  it("throws on corrupt JSON instead of silently wiping history", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("corrupt", { type: "redis", client });
    // Seed the key with invalid JSON directly, then a read/add must surface it.
    client.store.set("veryfront:agent:memory:corrupt:anonymous", "{not valid json");

    await assertRejects(() => memory.getMessages());
    await assertRejects(() => memory.add(msg("user", "x")));
    // The corrupt value must NOT have been overwritten by add().
    assertEquals(client.store.get("veryfront:agent:memory:corrupt:anonymous"), "{not valid json");
  });

  it("does not lose concurrent add() calls when an atomic Redis command surface is available", async () => {
    const store = new Map<string, string>();
    let getCalls = 0;
    let releaseConcurrentGets: (() => void) | undefined;
    const concurrentGetsReady = new Promise<void>((resolve) => {
      releaseConcurrentGets = resolve;
    });

    const client = {
      store,
      evalCalls: 0,
      lastEx: undefined as number | undefined,
      async get(key: string): Promise<string | null> {
        getCalls++;
        if (client.evalCalls === 0) {
          if (getCalls === 1) await concurrentGetsReady;
          if (getCalls === 2) releaseConcurrentGets?.();
        }
        return store.has(key) ? store.get(key)! : null;
      },
      set(key: string, value: string, options?: { EX?: number }): Promise<unknown> {
        store.set(key, value);
        client.lastEx = options?.EX;
        return Promise.resolve("OK");
      },
      del(key: string): Promise<number> {
        const existed = store.delete(key);
        return Promise.resolve(existed ? 1 : 0);
      },
      expire(_key: string, _seconds: number): Promise<number> {
        return Promise.resolve(1);
      },
      eval(
        _script: string,
        options: { keys: string[]; arguments: string[] },
      ): Promise<unknown> {
        client.evalCalls++;
        const key = options.keys[0]!;
        const [messageJson = "{}", maxMessagesRaw = "0", _maxTokensRaw = "0", ttlRaw = "0"] =
          options.arguments;
        const current = store.get(key);
        const messages = current ? JSON.parse(current) as Msg[] : [];
        messages.push(JSON.parse(messageJson) as Msg);

        const maxMessages = Number(maxMessagesRaw);
        const nextMessages = maxMessages > 0 ? messages.slice(-maxMessages) : messages;
        const ttl = Number(ttlRaw);
        client.lastEx = ttl > 0 ? ttl : undefined;
        store.set(key, JSON.stringify(nextMessages));
        return Promise.resolve(nextMessages.length);
      },
    } satisfies RedisClient & {
      store: Map<string, string>;
      evalCalls: number;
      lastEx?: number;
      eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
    };

    const memory = new RedisMemory<Msg>("race", { type: "redis", client });

    await Promise.all([
      memory.add(msg("user", "one")),
      memory.add(msg("assistant", "two")),
    ]);

    const messages = await memory.getMessages();
    assertEquals(messages.map((message) => message.content).sort(), ["one", "two"]);
    assertEquals(client.evalCalls, 2);
  });
});
