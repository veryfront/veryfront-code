import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRedisCacheAdministration } from "./cache-administration.ts";
import type { RedisClient, RedisClientManager } from "./redis-client-manager.ts";
import { REVISIONED_CACHE_KEY_PREFIX } from "veryfront/extensions/distributed/cache-support";

function createManager(client: Partial<RedisClient>): RedisClientManager {
  return {
    isConfigured: () => true,
    getClient: () => Promise.resolve(client as RedisClient),
    disconnect: () => Promise.resolve(),
  };
}

describe("Redis cache administration", () => {
  it("completes bounded cursor traversal and deduplicates keys", async () => {
    const requests: string[] = [];
    const administration = createRedisCacheAdministration(
      createManager({
        scan(cursor) {
          requests.push(cursor);
          return Promise.resolve(
            cursor === "0"
              ? { cursor: "2", keys: ["vf:cache:render:a", "vf:cache:render:a"] }
              : { cursor: "0", keys: ["vf:cache:render:b"] },
          );
        },
        mGet: (keys) => Promise.resolve(keys.map(() => "ordinary-value")),
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
    assertEquals(requests, ["0", "2"]);
  });

  it("reports truncation instead of claiming a partial listing is complete", async () => {
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () =>
          Promise.resolve({
            cursor: "0",
            keys: ["vf:cache:render:a", "vf:cache:render:b"],
          }),
        mGet: (keys) => Promise.resolve(keys.map(() => "ordinary-value")),
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
        scan: () => Promise.resolve({ cursor: "0", keys: ["vf:cache:other:key"] }),
      }),
      { url: "rediss://cache.example" },
    );

    await assertRejects(
      () => administration.listKeys({ prefix: "vf:cache:render:", limit: 10 }),
      TypeError,
      "invalid cache-administration SCAN result",
    );
  });

  it("batches exact logical deletions through one atomic command per batch", async () => {
    const batches: string[][] = [];
    const administration = createRedisCacheAdministration(
      createManager({
        eval(_script, options) {
          const batch = [...options.keys];
          batches.push(batch);
          assertEquals(options.arguments.length, 2);
          assertEquals(options.arguments[0], "0".repeat(batch.length));
          assertEquals(options.arguments[1], "vf-logical-delete-v1");
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
        eval: () => Promise.resolve(2),
      }),
      { url: "rediss://cache.example" },
    );
    await assertRejects(
      () => invalid.deleteKeys(["vf:cache:key"]),
      TypeError,
      "invalid cache-administration DEL count",
    );
  });

  it("filters absent tombstones and keeps scanning to satisfy the logical limit", async () => {
    let scans = 0;
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => {
          scans++;
          return Promise.resolve(
            scans === 1
              ? {
                cursor: "4",
                keys: [
                  "vf:cache:transform:vf:revisioned:v1:absent",
                  "vf:cache:transform:vf:revisioned:v1:present",
                ],
              }
              : { cursor: "0", keys: ["vf:cache:transform:ordinary"] },
          );
        },
        mGet: (keys) =>
          Promise.resolve(
            keys.map((key) =>
              key.endsWith(":absent")
                ? "\0VFCAS1\0a\0" + "1\0"
                : key.endsWith(":present")
                ? "\0VFCAS1\0p\0" + "2\0value"
                : "ordinary-value"
            ),
          ),
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:transform:", limit: 2 }),
      {
        keys: [
          "vf:cache:transform:vf:revisioned:v1:present",
          "vf:cache:transform:ordinary",
        ],
        truncated: false,
      },
    );
    assertEquals(scans, 2);
  });

  it("deletes tombstones but excludes them from the logical deletion count", async () => {
    const deleted: string[] = [];
    const administration = createRedisCacheAdministration(
      createManager({
        eval: (_script, options) => {
          deleted.push(...options.keys);
          assertEquals(options.arguments, ["011", "vf-logical-delete-v1"]);
          return Promise.resolve(2);
        },
      }),
      { url: "rediss://cache.example" },
    );
    const keys = [
      "vf:cache:transform:ordinary",
      "vf:cache:transform:vf:revisioned:v1:present",
      "vf:cache:transform:vf:revisioned:v1:absent",
    ];

    assertEquals(await administration.deleteKeys(keys), 2);
    assertEquals(deleted, keys);
  });

  it("treats a frame-looking value outside the reserved logical namespace as ordinary", async () => {
    const ordinaryKey = "vf:cache:render:ordinary:vf:revisioned:v1:suffix";
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => Promise.resolve({ cursor: "0", keys: [ordinaryKey] }),
        mGet: () => Promise.resolve(["\0VFCAS1\0a\0" + "7\0"]),
        eval: (_script, options) => {
          assertEquals(options.arguments, ["0", "vf-logical-delete-v1"]);
          return Promise.resolve(1);
        },
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:render:", limit: 10 }),
      { keys: [ordinaryKey], truncated: false },
    );
    assertEquals(await administration.deleteKeys([ordinaryKey]), 1);
  });

  it("filters nested tombstones from a broader owned-prefix listing", async () => {
    const tombstoneKey = "vf:cache:transform:vf:revisioned:v1:absent";
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => Promise.resolve({ cursor: "0", keys: [tombstoneKey] }),
        mGet: () => Promise.resolve(["\0VFCAS1\0a\0" + "9\0"]),
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:", limit: 10 }),
      { keys: [], truncated: false },
    );
  });

  it("fails closed for corrupt records under every prefix-owned reserved key", async () => {
    const malformedReservedKey = `vf:cache:transform:${REVISIONED_CACHE_KEY_PREFIX}`;
    let evalCalls = 0;
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => Promise.resolve({ cursor: "0", keys: [malformedReservedKey] }),
        mGet: () => Promise.resolve(["legacy-unframed"]),
        eval: (_script, options) => {
          evalCalls++;
          assertEquals(options.arguments, ["1", "vf-logical-delete-v1"]);
          return Promise.reject(new Error("corrupt reserved record"));
        },
      }),
      { url: "rediss://cache.example" },
    );

    await assertRejects(
      () => administration.listKeys({ prefix: "vf:cache:transform:", limit: 10 }),
      TypeError,
      "invalid framing",
    );
    await assertRejects(
      () => administration.deleteKeys([malformedReservedKey]),
      Error,
      "corrupt reserved record",
    );
    assertEquals(evalCalls, 1);
  });

  it("does not expose the hidden atomic counter through administration", async () => {
    const counterKey = "\0vf:cache:atomic:v1:counter:vf:cache:render:";
    let evalCalls = 0;
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () => Promise.resolve({ cursor: "0", keys: [] }),
        mGet: () => Promise.resolve([]),
        eval: () => {
          evalCalls++;
          return Promise.resolve(1);
        },
      }),
      { url: "rediss://cache.example" },
    );

    assertEquals(
      await administration.listKeys({ prefix: "vf:cache:render:", limit: 10 }),
      { keys: [], truncated: false },
    );
    await assertRejects(() => administration.deleteKeys([counterKey]), TypeError, "protected");
    assertEquals(evalCalls, 0);
  });

  it("enforces the physical traversal limit before decoding values", async () => {
    let mGetCalls = 0;
    const administration = createRedisCacheAdministration(
      createManager({
        scan: () =>
          Promise.resolve({
            cursor: "0",
            keys: Array.from(
              { length: 100_001 },
              (_, index) => `vf:cache:render:${index}`,
            ),
          }),
        mGet: () => {
          mGetCalls++;
          return Promise.resolve([]);
        },
      }),
      { url: "rediss://cache.example" },
    );

    await assertRejects(
      () => administration.listKeys({ prefix: "vf:cache:render:", limit: 1 }),
      RangeError,
      "key traversal limit",
    );
    assertEquals(mGetCalls, 0);
  });
});
