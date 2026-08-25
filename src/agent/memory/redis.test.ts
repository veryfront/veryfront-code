import { assertEquals, assertRejects } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import type { MinimalMessage } from "./memory-interface.ts";
import { type RedisClient, RedisMemory } from "./redis.ts";

/** Minimal in-memory RedisClient honoring the get/set/del/expire contract. */
function createFakeRedis(): RedisClient & {
  store: Map<string, string>;
  lastEx?: number;
  evalArgs: string[][];
} {
  const store = new Map<string, string>();
  const fake = {
    store,
    lastEx: undefined as number | undefined,
    evalArgs: [] as string[][],
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
      fake.evalArgs.push(options.arguments);
      const key = options.keys[0]!;
      const [messageJson = "{}", maxMessagesRaw = "0", maxTokensRaw = "0", ttlRaw = "0"] =
        options.arguments;
      const current = store.get(key);
      let messages: Msg[] = [];
      if (current) {
        // Mirror the decode_json contract in ATOMIC_ADD_SCRIPT: a stored value that
        // fails to decode aborts the add with an error reply and leaves the key alone.
        try {
          messages = JSON.parse(current) as Msg[];
        } catch {
          return Promise.reject(new Error("CORRUPT_REDIS_MEMORY_JSON:stored"));
        }
      }
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

  it("forwards maxMessages to the atomic add script and keeps the most recent", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("cap", { type: "redis", client, maxMessages: 2 });

    await memory.add(msg("user", "1"));
    await memory.add(msg("user", "2"));
    await memory.add(msg("user", "3"));

    assertEquals(
      client.evalArgs[0]?.[1],
      "2",
      "maxMessages must reach the Lua script as ARGV[2]",
    );

    const uncapped = createFakeRedis();
    await new RedisMemory<Msg>("uncapped", { type: "redis", client: uncapped })
      .add(msg("user", "x"));
    assertEquals(
      uncapped.evalArgs[0]?.[1],
      "0",
      "unset maxMessages must serialize as 0",
    );

    // The trimming below is performed by the fake, mirroring ATOMIC_ADD_SCRIPT.
    // Proof that the script itself trims needs a real Redis integration run.
    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages.map((m) => m.content), ["2", "3"]);
  });

  it("forwards maxTokens as the third EVAL argument and trims the oldest message", async () => {
    const client = createFakeRedis();
    const memory = new RedisMemory<Msg>("tok", { type: "redis", client, maxTokens: 1 });

    await memory.add(msg("user", "a".repeat(400)));
    await memory.add(msg("assistant", "b".repeat(400)));

    assertEquals(
      client.evalArgs[0]?.[2],
      "1",
      "RedisMemory must hand the configured maxTokens to the atomic add script",
    );
    assertEquals(
      (await memory.getMessages()).map((m) => m.content),
      ["b".repeat(400)],
      "token cap must drop the oldest message while keeping one",
    );
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

    await assertRejects(
      () => memory.getMessages(),
      SyntaxError,
      "JSON",
      "corrupt stored JSON must surface as a parse error, not an empty history",
    );
    await assertRejects(
      () => memory.add(msg("user", "x")),
      Error,
      "CORRUPT_REDIS_MEMORY_JSON:stored",
      "add must surface the script's corruption reply",
    );
    // The corrupt value must NOT have been overwritten by add().
    assertEquals(client.store.get("veryfront:agent:memory:corrupt:anonymous"), "{not valid json");
  });

  it("issues the atomic add through sendCommand with exactly one key", async () => {
    const calls: string[][] = [];
    const message = msg("user", "hello");
    const client: RedisClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve("OK"),
      del: () => Promise.resolve(0),
      expire: () => Promise.resolve(1),
      sendCommand(args: string[]): Promise<unknown> {
        calls.push(args);
        return Promise.resolve(1);
      },
    };

    await new RedisMemory<Msg>("send", {
      type: "redis",
      client,
      maxMessages: 5,
      maxTokens: 7,
      ttl: 60,
    }).add(message);

    assertEquals(calls[0]?.[0], "EVAL", "the atomic add must be issued as an EVAL command");
    assertEquals(
      calls[0]?.[2],
      "1",
      "sendCommand EVAL must declare exactly one key so the memory key is KEYS[1]",
    );
    assertEquals(
      calls[0]?.slice(3),
      [
        "veryfront:agent:memory:send:anonymous",
        JSON.stringify(message),
        "5",
        "7",
        "60",
      ],
      "sendCommand EVAL passes the key followed by the script arguments in order",
    );
  });

  it("issues the atomic add through call() when sendCommand is absent", async () => {
    const calls: string[][] = [];
    const message = msg("user", "hello");
    const client: RedisClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve("OK"),
      del: () => Promise.resolve(0),
      expire: () => Promise.resolve(1),
      call(command: string, ...args: string[]): Promise<unknown> {
        calls.push([command, ...args]);
        return Promise.resolve(1);
      },
    };

    await new RedisMemory<Msg>("call", {
      type: "redis",
      client,
      maxMessages: 5,
      maxTokens: 7,
      ttl: 60,
    }).add(message);

    assertEquals(calls[0]?.[0], "EVAL", "the atomic add must be issued as an EVAL command");
    assertEquals(
      calls[0]?.[2],
      "1",
      "call() EVAL must declare exactly one key so the memory key is KEYS[1]",
    );
    assertEquals(
      calls[0]?.slice(3),
      [
        "veryfront:agent:memory:call:anonymous",
        JSON.stringify(message),
        "5",
        "7",
        "60",
      ],
      "call() EVAL passes the key followed by the script arguments in order",
    );
  });

  it("rejects when the client exposes no atomic command surface", async () => {
    const client: RedisClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve("OK"),
      del: () => Promise.resolve(0),
      expire: () => Promise.resolve(1),
    };

    await assertRejects(
      () => new RedisMemory<Msg>("no-surface", { type: "redis", client }).add(msg("user", "x")),
      Error,
      "RedisMemory requires Redis sendCommand(), call(), or eval()",
      "an add without an atomic surface must fail loudly instead of silently dropping the message",
    );
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
