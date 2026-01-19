import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { MemoryKv } from "./memory-adapter.ts";

describe("MemoryKv", () => {
  describe("class", () => {
    it("should export MemoryKv class", () => {
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });

    it("should be instantiable", () => {
      const kv = new MemoryKv();
      assertExists(kv);
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

      const entries = [];
      for await (const entry of kv.list()) {
        entries.push(entry);
      }

      assertEquals(entries.length, 3);
    });

    it("should support limit option", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = [];
      for await (const entry of kv.list({ limit: 2 })) {
        entries.push(entry);
      }

      assertEquals(entries.length, 2);
    });
  });

  describe("close", () => {
    it("should clear the store on close", async () => {
      const kv = new MemoryKv();
      await kv.set(["test"], "value");
      kv.close();
      const result = await kv.get(["test"]);
      assertEquals(result.value, undefined);
    });
  });
});
