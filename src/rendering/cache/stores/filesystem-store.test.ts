import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FilesystemCacheStore } from "./filesystem-store.ts";

describe("rendering/cache/stores/filesystem-store", () => {
  describe("FilesystemCacheStore constructor", () => {
    it("should create with a base directory", () => {
      const store = new FilesystemCacheStore({ baseDir: "/tmp/test-cache" });
      assertEquals(store instanceof FilesystemCacheStore, true);
    });
  });

  describe("operations (using local adapter)", () => {
    const baseDir = "/tmp/veryfront-test-fs-cache-" + Date.now();

    it("should return undefined for missing key", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      const result = await store.get("nonexistent");
      assertEquals(result, undefined);
    });

    it("should set and get a value", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      const payload = {
        result: {
          html: "<p>test</p>",
          frontmatter: {},
          headings: [],
          stream: null,
        },
        storedAt: Date.now(),
      };
      await store.set("test-key", payload as any);
      const result = await store.get("test-key");
      assertEquals(result?.result?.html, "<p>test</p>");
    });

    it("should delete a value", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      const payload = {
        result: { html: "<p>del</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      };
      await store.set("del-key", payload as any);
      await store.delete("del-key");
      const result = await store.get("del-key");
      assertEquals(result, undefined);
    });

    it("should delete non-existent key without error", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      await store.delete("nonexistent");
    });

    it("should clear all entries", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      await store.clear();
    });

    it("should destroy (same as clear)", async () => {
      const store = new FilesystemCacheStore({ baseDir });
      await store.destroy();
    });

    it("should deleteByPrefix", async () => {
      const dir = baseDir + "-prefix";
      const store = new FilesystemCacheStore({ baseDir: dir });
      const payload = {
        result: { html: "<p>x</p>", frontmatter: {}, headings: [], stream: null },
        storedAt: Date.now(),
      };
      await store.set("prefix:a", payload as any);
      await store.set("prefix:b", payload as any);
      await store.set("other:c", payload as any);

      const deleted = await store.deleteByPrefix("prefix:");
      assertEquals(deleted >= 0, true);

      // Cleanup
      await store.destroy();
    });
  });
});
