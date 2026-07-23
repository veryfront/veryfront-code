import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryKv } from "./memory-adapter.ts";
import { KV_PORTABLE_LIMITS } from "./types.ts";

async function collectEntries<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const entries: T[] = [];
  for await (const entry of iterable) {
    entries.push(entry);
  }
  return entries;
}

describe("MemoryKv", () => {
  describe("class", () => {
    it("should export MemoryKv class", () => {
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });

    it("should be instantiable", () => {
      assertExists(new MemoryKv());
    });

    it("should have all required methods", () => {
      const kv = new MemoryKv();
      assertExists(kv.get);
      assertExists(kv.set);
      assertExists(kv.delete);
      assertExists(kv.list);
      assertExists(kv.close);
    });
  });

  describe("get/set", () => {
    it("should store and retrieve values", async () => {
      const kv = new MemoryKv();
      await kv.set(["test", "key"], "value");

      const result = await kv.get(["test", "key"]);
      assertEquals(result.value, "value");
      assertExists(result.versionstamp);
    });

    it("should return undefined for non-existent keys", async () => {
      const kv = new MemoryKv();
      const result = await kv.get(["non", "existent"]);
      assertEquals(result.value, undefined);
    });
  });

  describe("delete", () => {
    it("should delete values", async () => {
      const kv = new MemoryKv();
      await kv.set(["test", "key"], "value");
      await kv.delete(["test", "key"]);

      const result = await kv.get(["test", "key"]);
      assertEquals(result.value, undefined);
    });
  });

  describe("list", () => {
    it("should list all entries", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = await collectEntries(kv.list());
      assertEquals(entries.length, 3);
    });

    it("should support limit option", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = await collectEntries(kv.list({ limit: 2 }));
      assertEquals(entries.length, 2);
    });

    it("enforces the default scan bound when no list limit is supplied", async () => {
      const kv = new MemoryKv();
      for (let index = 0; index <= KV_PORTABLE_LIMITS.defaultListScanEntries; index++) {
        await kv.set(["entry", String(index)], index);
      }

      await assertRejects(
        () => collectEntries(kv.list()),
        Error,
        "KV list scan exceeded",
      );
      kv.close();
    });
  });

  describe("close", () => {
    it("should reject reads after close", async () => {
      const kv = new MemoryKv();
      await kv.set(["test"], "value");
      kv.close();

      await assertRejects(() => kv.get(["test"]), Error, "KV store is closed");
    });
  });
});
