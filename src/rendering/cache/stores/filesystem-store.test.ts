import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { FilesystemCacheStore } from "./filesystem-store.ts";
import type { CachePayload } from "../types.ts";

function makePayload(html = "<p>x</p>"): CachePayload {
  return {
    result: { html, frontmatter: {}, headings: [], stream: null },
    storedAt: Date.now(),
  } as unknown as CachePayload;
}

describe("rendering/cache/stores/filesystem-store", () => {
  describe("FilesystemCacheStore constructor", () => {
    it("should write entries under the configured base directory", async () => {
      const dir = "/tmp/veryfront-test-fs-cache-ctor-" + Date.now();
      const store = new FilesystemCacheStore({ baseDir: dir });

      try {
        await store.set("test key/a", makePayload());

        const fs = (await getLocalAdapter()).fs;
        const raw = await fs.readFile(join(dir, `${encodeURIComponent("test key/a")}.json`));

        assertEquals(typeof raw, "string", "entries are written under the configured baseDir");
      } finally {
        await store.destroy();
      }
    });

    it("keeps stores with different baseDirs isolated", async () => {
      const suffix = Date.now();
      const first = new FilesystemCacheStore({ baseDir: `/tmp/veryfront-test-fs-iso-a-${suffix}` });
      const second = new FilesystemCacheStore({
        baseDir: `/tmp/veryfront-test-fs-iso-b-${suffix}`,
      });

      try {
        await first.set("shared-key", makePayload());

        assertEquals(
          (await first.get("shared-key"))?.result.html,
          "<p>x</p>",
          "the first store reads back its own entry",
        );
        assertEquals(
          await second.get("shared-key"),
          undefined,
          "a second baseDir must not see the first store's entries",
        );
      } finally {
        await first.destroy();
        await second.destroy();
      }
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

    it("preserves Dates through an actual file round-trip", async () => {
      const dir = baseDir + "-dates";
      const store = new FilesystemCacheStore({ baseDir: dir });
      const publishedAt = new Date("2026-07-24T08:30:00.000Z");
      const payload: CachePayload = {
        result: {
          html: "<p>dated</p>",
          frontmatter: { publishedAt } as unknown as CachePayload["result"]["frontmatter"],
          nodeMap: new Map([[1, { revisedAt: new Date("2026-07-25T09:45:00.000Z") }]]),
          stream: null,
        },
        storedAt: Date.now(),
      };

      try {
        await store.set("dated-key", payload);
        const result = await store.get("dated-key");

        assertEquals(result?.result.frontmatter as unknown, { publishedAt });
        assertEquals(result?.result.nodeMap?.get(1), {
          revisedAt: new Date("2026-07-25T09:45:00.000Z"),
        });
      } finally {
        await store.destroy();
      }
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
      const dir = baseDir + "-clear";
      const store = new FilesystemCacheStore({ baseDir: dir });

      try {
        await store.set("clear:a", makePayload());
        await store.set("clear:b", makePayload());

        assertEquals(
          (await store.get("clear:a"))?.result.html,
          "<p>x</p>",
          "the entry is readable before clear()",
        );

        await store.clear();

        assertEquals(await store.get("clear:a"), undefined, "clear() must remove cached entries");
        assertEquals(await store.get("clear:b"), undefined, "clear() must remove every entry");

        await store.set("clear:c", makePayload());
        assertEquals(
          (await store.get("clear:c"))?.result.html,
          "<p>x</p>",
          "the store must remain usable after clear() removes its directory",
        );
      } finally {
        await store.destroy();
      }
    });

    it("should destroy (same as clear)", async () => {
      const dir = baseDir + "-destroy";
      const store = new FilesystemCacheStore({ baseDir: dir });

      await store.set("a", makePayload());
      await store.set("b", makePayload());

      assertEquals(
        (await store.get("a"))?.result.html,
        "<p>x</p>",
        "the entry is readable before destroy",
      );

      await store.destroy();

      assertEquals(await store.get("a"), undefined, "destroy removes stored entries");
      assertEquals(await store.get("b"), undefined, "destroy removes every stored entry");
    });

    it("should deleteByPrefix", async () => {
      const dir = baseDir + "-prefix";
      const store = new FilesystemCacheStore({ baseDir: dir });

      try {
        await store.set("prefix:a", makePayload());
        await store.set("prefix:b", makePayload());
        await store.set("other:c", makePayload());

        const deleted = await store.deleteByPrefix("prefix:");

        assertEquals(deleted, 2, "deleteByPrefix removes both prefixed entries");
        assertEquals(await store.get("prefix:a"), undefined, "prefix:a is deleted");
        assertEquals(await store.get("prefix:b"), undefined, "prefix:b is deleted");
        assertEquals(
          (await store.get("other:c"))?.result.html,
          "<p>x</p>",
          "a non-matching key is preserved",
        );
      } finally {
        await store.destroy();
      }
    });
  });
});
