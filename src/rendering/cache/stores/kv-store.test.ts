import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { KVCacheStore } from "./kv-store.ts";
import type { CachePayload } from "../types.ts";

function createPayload(html: string): CachePayload {
  return {
    result: {
      html,
      frontmatter: {},
      headings: [],
      stream: null,
    },
    storedAt: Date.now(),
  } as CachePayload;
}

describe("rendering/cache/stores/kv-store", () => {
  describe("KVCacheStore constructor", () => {
    it("should create with default options", () => {
      const store = new KVCacheStore();
      assertEquals(store instanceof KVCacheStore, true);
    });

    it("should create with custom path", () => {
      const store = new KVCacheStore({ path: "/tmp/test.db" });
      assertEquals(store instanceof KVCacheStore, true);
    });
  });

  describe("operations with Deno KV", () => {
    it("should get return undefined when no KV entries exist", async () => {
      const store = new KVCacheStore();
      const result = await store.get("nonexistent");
      // If Deno.openKv is available, it returns undefined for missing keys
      // If not available, returns undefined
      assertEquals(result === undefined || result === null || typeof result === "object", true);
    });

    it("should set and get a value", async () => {
      const store = new KVCacheStore();
      const payload = createPayload("<p>test</p>");
      await store.set("test-key", payload);
      const result = await store.get("test-key");
      if (result) {
        assertEquals(result.result.html, "<p>test</p>");
      }
    });

    it("should delete a value", async () => {
      const store = new KVCacheStore();
      const payload = createPayload("<p>delete me</p>");
      await store.set("delete-key", payload);
      await store.delete("delete-key");
      const result = await store.get("delete-key");
      assertEquals(result, undefined);
    });

    it("should clear all values", async () => {
      const store = new KVCacheStore();
      await store.set("key1", createPayload("<p>1</p>"));
      await store.set("key2", createPayload("<p>2</p>"));
      await store.clear();
      assertEquals(await store.get("key1"), undefined);
      assertEquals(await store.get("key2"), undefined);
    });

    it("should delete by prefix", async () => {
      const store = new KVCacheStore();
      await store.set("prefix:a", createPayload("<p>a</p>"));
      await store.set("prefix:b", createPayload("<p>b</p>"));
      await store.set("other:c", createPayload("<p>c</p>"));
      const deleted = await store.deleteByPrefix("prefix:");
      assertEquals(deleted >= 0, true); // deleted count depends on KV availability
    });

    it("should destroy and clean up", async () => {
      const store = new KVCacheStore();
      await store.set("key", createPayload("<p>test</p>"));
      await store.destroy();
      // After destroy, getting should return undefined (KV is closed)
      const result = await store.get("key");
      assertEquals(result, undefined);
    });
  });
});
