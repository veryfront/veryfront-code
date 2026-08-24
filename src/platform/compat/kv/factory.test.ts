import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createKVStore, openKv, polyfillDenoKv } from "./factory.ts";

describe("kv/factory", () => {
  describe("openKv", () => {
    it("should export openKv function", () => {
      assertExists(openKv);
      assertEquals(typeof openKv, "function");
    });

    it("should return a KV store", async () => {
      const kv = await openKv();
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      assertExists(kv.delete);
      assertExists(kv.list);
      assertExists(kv.close);
      kv.close();
    });

    it("fails closed when an explicit persistent path has no durable backend", async () => {
      await assertRejects(
        () => openKv("./requested-persistent-store.sqlite"),
        Error,
        "durable KV store",
      );
    });
  });

  describe("createKVStore", () => {
    it("should export createKVStore function", () => {
      assertExists(createKVStore);
      assertEquals(typeof createKVStore, "function");
    });

    it("should create a KV store", async () => {
      const kv = await createKVStore();
      assertExists(kv);
      assertExists(kv.get);
      assertExists(kv.set);
      kv.close();
    });
  });

  describe("polyfillDenoKv", () => {
    it("should export polyfillDenoKv function", () => {
      assertExists(polyfillDenoKv);
      assertEquals(typeof polyfillDenoKv, "function");
    });

    it("leaves the native Deno namespace untouched on the Deno lane", () => {
      const g = globalThis as { Deno?: { openKv?: unknown } };
      const originalDeno = g.Deno;
      polyfillDenoKv();
      assertStrictEquals(
        g.Deno,
        originalDeno,
        "the Deno lane leaves the native namespace untouched",
      );
    });
  });

  describe("KV store operations", () => {
    it("should support get/set/delete operations", async () => {
      const kv = await openKv();
      await kv.set(["test", "kvfactory"], "value123");
      const result = await kv.get(["test", "kvfactory"]);
      assertExists(result);
      assertEquals(result.value, "value123");
      await kv.delete(["test", "kvfactory"]);
      const deleted = await kv.get(["test", "kvfactory"]);
      assertEquals(deleted.value, undefined);
      await kv.close();
    });

    it("should support list operation", async () => {
      const kv = await openKv();
      await kv.set(["list", "a"], "1");
      await kv.set(["list", "b"], "2");
      const entries: unknown[] = [];
      for await (const entry of kv.list({ prefix: ["list"] })) {
        entries.push(entry);
      }
      assertEquals(entries.length >= 2, true);
      await kv.delete(["list", "a"]);
      await kv.delete(["list", "b"]);
      kv.close();
    });

    it("should create store with createKVStore", async () => {
      const kv = await createKVStore();
      assertExists(kv.get);
      assertExists(kv.set);
      kv.close();
    });
  });
});
