import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRedisCacheAdministration } from "./cache-administration.ts";
import type { RedisClient, RedisClientManager } from "./redis-client-manager.ts";

function createManager(client: Partial<RedisClient>): RedisClientManager {
  return {
    isConfigured: () => true,
    getClient: () => Promise.resolve(client as RedisClient),
    disconnect: () => Promise.resolve(),
  };
}

describe("Redis cache administration", () => {
  it("completes bounded cursor traversal and deduplicates keys", async () => {
    const requests: number[] = [];
    const administration = createRedisCacheAdministration(
      createManager({
        scan(cursor) {
          requests.push(cursor);
          return Promise.resolve(
            cursor === 0
              ? { cursor: 2, keys: ["vf:cache:render:a", "vf:cache:render:a"] }
              : { cursor: 0, keys: ["vf:cache:render:b"] },
          );
        },
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:render:", limit: 10 }),
      {
        keys: ["vf:cache:render:a", "vf:cache:render:b"],
        truncated: false,
      },
    );
    assertEquals(requests, [0, 2]);
  });

  it("reports truncation instead of claiming a partial listing is complete", async () => {
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () =>
          Promise.resolve({
            cursor: 0,
            keys: ["vf:cache:render:a", "vf:cache:render:b"],
          }),
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:render:", limit: 1 }),
      { keys: ["vf:cache:render:a"], truncated: true },
    );
  });

  it("rejects keys outside the requested literal prefix", async () => {
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => Promise.resolve({ cursor: 0, keys: ["vf:cache:other:key"] }),
      }),
      { url: "rediss://cache.example" },
    );

    await assertRejects(
      () => administration.listKeys({ prefix: "vf:cache:render:", limit: 10 }),
      TypeError,
      "invalid cache-administration SCAN result",
    );
  });

  it("batches exact deletions and validates provider counts", async () => {
    const batches: string[][] = [];
    const administration = createRedisCacheAdministration(
      createManager({
        del(keys) {
          const batch = Array.isArray(keys) ? [...keys] : [keys];
          batches.push(batch);
          return Promise.resolve(batch.length);
        },
      }),
      { url: "rediss://cache.example" },
    );
    const keys = Array.from({ length: 1_001 }, (_, index) => `vf:cache:key:${index}`);

    assertEquals(await administration.deleteKeys(keys), 1_001);
    assertEquals(batches.map((batch) => batch.length), [1_000, 1]);

    const invalid = createRedisCacheAdministration(
      createManager({
        del: () => Promise.resolve(2),
      }),
      { url: "rediss://cache.example" },
    );
    await assertRejects(
      () => invalid.deleteKeys(["vf:cache:key"]),
      TypeError,
      "invalid cache-administration DEL count",
    );
  });
});
