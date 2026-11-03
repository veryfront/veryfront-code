import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import type { TokenCacheEntry } from "veryfront/extensions/cache";
import { RedisTokenCacheStore } from "../../../extensions/ext-cache-redis/src/redis-cache.ts";
import { createStubClientFactory } from "../../../extensions/ext-cache-redis/src/test-utils.ts";

const READONLY = "READONLY You can't write against a read only replica.";

function setup(
  configure: (client: ReturnType<typeof createStubClientFactory>["client"], index: number) => void =
    () => {},
) {
  const clients: Array<ReturnType<typeof createStubClientFactory> & { destroyed: number }> = [];
  const store = new RedisTokenCacheStore({ url: "redis://writer:6379" }, {
    clientFactory: (options) => {
      const next = { ...createStubClientFactory(), destroyed: 0 };
      next.client.destroy = () => {
        next.destroyed++;
      };
      configure(next.client, clients.length);
      clients.push(next);
      return next.factory(options);
    },
  });
  return { store, clients };
}

function current(clients: ReturnType<typeof setup>["clients"], index: number) {
  const client = clients[index];
  assertExists(client);
  return client;
}

function entry(): TokenCacheEntry {
  return {
    token: "same-token",
    scope: "preview",
    projectSlug: "acme",
    expiresAt: Date.now() + 60_000,
  };
}

it("Redis shares concurrent initial connection and fences stale client errors", async () => {
  const { store, clients } = setup();
  await Promise.all([store.has("a"), store.has("b")]);
  assertEquals(clients.length, 1);
  current(clients, 0).client._emitError(new Error("Socket closed unexpectedly"));
  await store.has("c");
  assertEquals(clients.length, 2);
  assertEquals(current(clients, 0).destroyed, 1);
  current(clients, 0).client._emitError(new Error("late old socket error"));
  await store.has("d");
  assertEquals(clients.length, 2);
  await store.close();
  assertEquals(current(clients, 1).destroyed, 1);
});

it("Redis retries exact replica SET refusal once on fresh writer connection", async () => {
  const { store, clients } = setup();
  await store.has("a");
  const value = entry();
  let attempts = 0;
  current(clients, 0).client.setEx = () => {
    attempts++;
    return Promise.reject(new Error(READONLY));
  };
  await store.set("a", value);
  assertEquals(attempts, 1);
  assertEquals(clients.length, 2);
  assertEquals(current(clients, 0).destroyed, 1);
  assertEquals(await store.get("a"), value);
  await store.close();
});

it("Redis never retries transport failure or expired GET cleanup", async () => {
  const { store, clients } = setup();
  await store.has("a");
  current(clients, 0).client.setEx = () => Promise.reject(new Error("connection reset"));
  await assertRejects(() => store.set("a", entry()), Error, "connection reset");
  assertEquals(clients.length, 1);
  await store.has("a");
  current(clients, 1).client.get = () =>
    Promise.resolve(JSON.stringify({ ...entry(), expiresAt: 0 }));
  current(clients, 1).client.del = () => Promise.reject(new Error(READONLY));
  await assertRejects(() => store.get("a"), Error, READONLY);
  assertEquals(clients.length, 2);
  await store.close();
});

it("Redis close fences a pending connection and prevents resurrection", async () => {
  const { store, clients } = setup();
  // Factory creation occurs synchronously when the first operation starts.
  const first = store.has("a");
  await store.close();
  await assertRejects(() => first, Error, "closed");
  await assertRejects(() => store.has("b"), Error, "closed");
  assertEquals(clients.length, 1);
  assertEquals(current(clients, 0).destroyed, 1);
});

it("Redis bounds repeated replica refusal to two SET attempts", async () => {
  let attempts = 0;
  const { store, clients } = setup((client) => {
    client.setEx = () => {
      attempts++;
      return Promise.reject(new Error(READONLY));
    };
  });
  await assertRejects(() => store.set("a", entry()), Error, READONLY);
  assertEquals(attempts, 2);
  assertEquals(clients.length, 2);
  assertEquals(clients.map((client) => client.destroyed), [1, 1]);
  await store.close();
});

it("Redis recomputes retry TTL without changing token or extending expiry", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  const writes: Array<{ ttl: number; value: string }> = [];
  const { store } = setup((client, index) => {
    client.setEx = (_key, ttl, value) => {
      writes.push({ ttl, value });
      if (index === 0) {
        now += 2_000;
        return Promise.reject(new Error(READONLY));
      }
      return Promise.resolve("OK");
    };
  });
  try {
    const value = entry();
    await store.set("a", value);
    assertEquals(writes.map((write) => write.ttl), [60, 58]);
    assertEquals(writes.map((write) => write.value), [
      JSON.stringify(value),
      JSON.stringify(value),
    ]);
  } finally {
    Date.now = originalNow;
    await store.close();
  }
});

it("Redis refuses retry when the original token expires during recovery", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  let attempts = 0;
  const { store } = setup((client) => {
    client.setEx = () => {
      attempts++;
      now += 60_000;
      return Promise.reject(new Error(READONLY));
    };
  });
  try {
    await assertRejects(() => store.set("a", entry()), Error, "expired during replica recovery");
    assertEquals(attempts, 1);
  } finally {
    Date.now = originalNow;
    await store.close();
  }
});

it("Redis late command failure cannot dispose a replacement client", async () => {
  const { store, clients } = setup();
  await store.has("a");
  const failure = Promise.withResolvers<number>();
  current(clients, 0).client.exists = () => failure.promise;
  const pending = store.has("old");
  await Promise.resolve();
  current(clients, 0).client._emitError(new Error("connection reset"));
  await store.has("new");
  failure.reject(new Error("late command failure"));
  await assertRejects(() => pending, Error, "late command failure");
  await store.has("still-new");
  assertEquals(clients.length, 2);
  assertEquals(current(clients, 1).destroyed, 0);
  await store.close();
});

it("Redis concurrent replica refusals share one replacement connection", async () => {
  const { store, clients } = setup((client, index) => {
    if (index === 0) client.setEx = () => Promise.reject(new Error(READONLY));
  });
  await store.has("a");
  await Promise.all([store.set("a", entry()), store.set("b", entry())]);
  assertEquals(clients.length, 2);
  assertEquals(current(clients, 0).destroyed, 1);
  await store.close();
});

it("Redis failed connection is disposed before the next operation reconnects", async () => {
  const { store, clients } = setup((client, index) => {
    if (index === 0) client.connect = () => Promise.reject(new Error("connect refused"));
  });
  await assertRejects(() => store.has("a"), Error, "connect refused");
  assertEquals(current(clients, 0).destroyed, 1);
  await store.has("b");
  assertEquals(clients.length, 2);
  await store.close();
});

it("Redis preserves the client's configured startup reconnect before readiness", async () => {
  const { store, clients } = setup((client) => {
    client.connect = () => {
      client._emitError(new Error("connection reset"));
      return Promise.resolve();
    };
  });
  await store.has("a");
  assertEquals(clients.length, 1);
  assertEquals(current(clients, 0).destroyed, 0);
  await store.close();
});
