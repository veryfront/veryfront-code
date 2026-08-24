import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { KVCacheStore } from "#veryfront/rendering/cache/stores/kv-store.ts";
import type { CachePayload } from "#veryfront/rendering/cache/types.ts";

type OpenKv = (path?: string) => Promise<unknown>;

interface FakeKvEntry {
  key: unknown[];
  value: unknown;
}

function encodeKey(key: unknown[]): string {
  return JSON.stringify(key);
}

function createFakeKv() {
  const entries = new Map<string, FakeKvEntry>();
  const fake = {
    entries,
    closeCalls: 0,
    openCalls: 0,
    openedPaths: [] as Array<string | undefined>,
    get(key: unknown[]): Promise<{ value: unknown }> {
      return Promise.resolve({ value: entries.get(encodeKey(key))?.value ?? null });
    },
    set(key: unknown[], value: unknown): Promise<void> {
      entries.set(encodeKey(key), { key: [...key], value });
      return Promise.resolve();
    },
    delete(key: unknown[]): Promise<void> {
      entries.delete(encodeKey(key));
      return Promise.resolve();
    },
    list({ prefix }: { prefix: unknown[] }): AsyncIterable<{ key: unknown[] }> {
      const matched = [...entries.values()].filter((entry) =>
        prefix.every((part, index) => entry.key[index] === part)
      );
      return (async function* () {
        for (const entry of matched) yield { key: entry.key };
      })();
    },
    close(): Promise<void> {
      fake.closeCalls++;
      return Promise.resolve();
    },
  };
  return fake;
}

function withStubbedOpenKv<T>(openKv: OpenKv | undefined, run: () => Promise<T>): Promise<T> {
  const denoNamespace = globalThis.Deno as unknown as { openKv?: OpenKv };
  const previousOpenKv = denoNamespace.openKv;

  if (openKv === undefined) delete denoNamespace.openKv;
  else denoNamespace.openKv = openKv;

  return run().finally(() => {
    if (previousOpenKv === undefined) delete denoNamespace.openKv;
    else denoNamespace.openKv = previousOpenKv;
  });
}

function withFakeKv(
  run: (store: KVCacheStore, kv: ReturnType<typeof createFakeKv>) => Promise<void>,
  options: { path?: string } = {},
): Promise<void> {
  const kv = createFakeKv();

  return withStubbedOpenKv((path?: string) => {
    kv.openCalls++;
    kv.openedPaths.push(path);
    return Promise.resolve(kv);
  }, async () => {
    const store = new KVCacheStore(options);
    try {
      await run(store, kv);
    } finally {
      await store.destroy();
    }
  });
}

function payload(html: string): CachePayload {
  return { result: { html, frontmatter: {}, stream: null }, storedAt: 1_000 };
}

// KVCacheStore reaches for Deno.openKv on the runtime namespace, so every case
// below has to stub that namespace. That is a host effect, which is why these
// cases live here instead of in the colocated unit test.
describe("rendering/cache/stores/kv-store against a stubbed Deno KV", () => {
  describe("KVCacheStore constructor", () => {
    it("should create with custom path", async () => {
      await withFakeKv(async (store, kv) => {
        await store.get("any-key");

        assertEquals(kv.openedPaths, ["/tmp/test.db"], "the configured path must reach openKv");
      }, { path: "/tmp/test.db" });
    });
  });

  describe("operations with Deno KV", () => {
    it("should return undefined for get on nonexistent key", async () => {
      await withFakeKv(async (store, kv) => {
        assertEquals(
          await store.get("nonexistent-key"),
          undefined,
          "a missing key must read as undefined",
        );
        assertEquals(kv.entries.size, 0, "a read must not create a KV entry");
      });
    });

    it("round-trips a payload under the render key namespace", async () => {
      await withFakeKv(async (store, kv) => {
        await store.set("k1", payload("<p>x</p>"));

        assertEquals(
          [...kv.entries.values()].map((entry) => entry.key),
          [["veryfront", "render", "k1"]],
          "entries must be stored under the render key namespace",
        );
        assertEquals(
          (await store.get("k1"))?.result.html,
          "<p>x</p>",
          "a stored payload must read back",
        );
      });
    });

    it("should handle delete on nonexistent key", async () => {
      await withFakeKv(async (store) => {
        await store.set("kept", payload("<p>kept</p>"));

        await store.delete("nonexistent-key");
        assertEquals(
          (await store.get("kept"))?.result.html,
          "<p>kept</p>",
          "deleting a missing key must not touch other entries",
        );

        await store.delete("kept");
        assertEquals(await store.get("kept"), undefined, "delete must remove the addressed entry");
      });
    });

    it("clear removes every render entry", async () => {
      await withFakeKv(async (store, kv) => {
        const foreignKey = ["veryfront", "sessions", "k3"];
        await store.set("k1", payload("<p>x</p>"));
        await store.set("k2", payload("<p>y</p>"));
        kv.entries.set(encodeKey(foreignKey), { key: foreignKey, value: payload("<p>z</p>") });

        assertEquals(
          (await store.get("k1"))?.result.html,
          "<p>x</p>",
          "entry is readable before clear",
        );

        await store.clear();

        assertEquals(await store.get("k1"), undefined, "clear removes k1");
        assertEquals(await store.get("k2"), undefined, "clear removes k2");
        assertEquals(
          [...kv.entries.values()].map((entry) => entry.key),
          [foreignKey],
          "clear must not touch other KV namespaces",
        );
      });
    });

    it("deleteByPrefix removes only prefixed keys", async () => {
      await withFakeKv(async (store) => {
        await store.set("a:1", payload("<p>a1</p>"));
        await store.set("a:2", payload("<p>a2</p>"));
        await store.set("b:1", payload("<p>b1</p>"));

        assertEquals(
          await store.deleteByPrefix("a:"),
          2,
          "deleteByPrefix removes only prefixed keys",
        );
        assertEquals(await store.get("a:1"), undefined, "prefixed entries are gone");
        assertEquals(await store.get("a:2"), undefined, "every prefixed entry is gone");
        assertEquals(
          (await store.get("b:1"))?.result.html,
          "<p>b1</p>",
          "non-matching keys survive a prefix invalidation",
        );
      });
    });

    it("should handle destroy without error", async () => {
      await withFakeKv(async (store, kv) => {
        await store.set("k1", payload("<p>x</p>"));

        await store.destroy();
        assertEquals(kv.closeCalls, 1, "destroy must close the KV handle");

        assertEquals(
          (await store.get("k1"))?.result.html,
          "<p>x</p>",
          "a read after destroy must reopen the KV handle",
        );
        assertEquals(kv.openCalls, 2, "the KV handle must be reopened lazily");
      });
    });

    it("should return undefined after destroy", async () => {
      await withFakeKv(async (store) => {
        await store.destroy();

        assertEquals(
          await store.get("key"),
          undefined,
          "a missing key still reads as undefined after destroy",
        );
      });
    });
  });

  describe("operations without a KV implementation", () => {
    it("resolves to undefined when no KV implementation is available", async () => {
      await withStubbedOpenKv(undefined, async () => {
        const store = new KVCacheStore();

        try {
          await store.set("k", payload("<p>x</p>"));

          assertEquals(
            await store.get("k"),
            undefined,
            "reads fall back to undefined without a KV implementation",
          );
          assertEquals(
            await store.deleteByPrefix("k"),
            0,
            "prefix deletes report nothing without a KV implementation",
          );
          await store.clear();
        } finally {
          await store.destroy();
        }
      });
    });
  });
});
