import "#veryfront/schemas/_test-setup.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { MAX_CACHE_TTL_SECONDS } from "#veryfront/cache/backends/ttl.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseCachePayload } from "../cache-payload.ts";
import type { CachePayload } from "../types.ts";
import { APICacheStore } from "./api-store.ts";
import { escapeRedisCacheGlobLiteral } from "#veryfront/cache/backends/redis-keyspace.ts";

function payload(html: string, overrides: Partial<CachePayload> = {}): CachePayload {
  return {
    result: {
      html,
      css: "body{}",
      frontmatter: { tags: ["Original"] },
      headings: [{ id: "heading", text: "Original", level: 1 }],
      nodeMap: new Map([[1, { type: "heading" }]]),
      stream: null,
      pageModule: { slug: "page", code: "export default {}", type: "mdx" },
      ssrHash: "hash",
    },
    storedAt: Date.now(),
    ...overrides,
  };
}

class FakeApiBackend implements CacheBackend {
  readonly type = "api" as const;
  readonly values = new Map<string, string>();
  readonly setTtls: number[] = [];
  readonly patterns: string[] = [];
  getCount = 0;
  failGet: Error | null = null;
  failSet: Error | null = null;
  failDelete: Error | null = null;
  failPatternDelete: Error | null = null;

  get(key: string): Promise<string | null> {
    this.getCount++;
    if (this.failGet) return Promise.reject(this.failGet);
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ttlSeconds = 300): Promise<void> {
    if (this.failSet) return Promise.reject(this.failSet);
    this.values.set(key, value);
    this.setTtls.push(ttlSeconds);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    if (this.failDelete) return Promise.reject(this.failDelete);
    this.values.delete(key);
    return Promise.resolve();
  }

  delByPattern(pattern: string): Promise<number> {
    this.patterns.push(pattern);
    if (this.failPatternDelete) return Promise.reject(this.failPatternDelete);
    const prefix = decodeLiteralPrefixPattern(pattern);
    let deleted = 0;
    for (const key of [...this.values.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.values.delete(key);
      deleted++;
    }
    return Promise.resolve(deleted);
  }
}

function decodeLiteralPrefixPattern(pattern: string): string {
  if (!pattern.endsWith("*")) {
    throw new TypeError("fake backend only supports suffix wildcards");
  }
  const literal = pattern.slice(0, -1);
  let prefix = "";
  for (let index = 0; index < literal.length; index++) {
    const char = literal[index]!;
    if (char === "\\") {
      const escaped = literal[++index];
      if (escaped === undefined || !"\\*?[]".includes(escaped)) {
        throw new TypeError("fake backend received an invalid glob escape");
      }
      prefix += escaped;
      continue;
    }
    if ("*?[]".includes(char)) {
      throw new TypeError("fake backend only supports an escaped literal prefix");
    }
    prefix += char;
  }
  return prefix;
}

function storeWith(
  backend: CacheBackend,
  options: Omit<ConstructorParameters<typeof APICacheStore>[0], "backendFactory"> = {},
): APICacheStore {
  return new APICacheStore({ ...options, backendFactory: () => Promise.resolve(backend) });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("rendering/cache/stores/api-store", () => {
  describe("constructor", () => {
    it("accepts valid options", () => {
      assertEquals(new APICacheStore() instanceof APICacheStore, true);
      assertEquals(
        new APICacheStore({
          keyPrefix: "custom:render",
          ttlSeconds: 7_200,
          localMaxEntries: 50,
          enableLocalCache: false,
        }) instanceof APICacheStore,
        true,
      );
    });

    it("rejects unsafe prefixes, TTLs, and capacities", () => {
      for (const keyPrefix of ["", " render", "render*", "render?", "render[all]"]) {
        assertThrows(() => new APICacheStore({ keyPrefix }), TypeError, "glob-free");
      }
      for (const ttlSeconds of [0, -1, 1.5, Infinity, MAX_CACHE_TTL_SECONDS + 1]) {
        assertThrows(() => new APICacheStore({ ttlSeconds }), RangeError);
      }
      for (const localMaxEntries of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assertThrows(() => new APICacheStore({ localMaxEntries }), RangeError);
      }
    });
  });

  describe("authoritative and local behavior", () => {
    it("round-trips the full payload and returns detached local snapshots", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      const original = payload("<h1>Original</h1>");

      await store.set("page", original);
      (original.result.frontmatter as { tags: string[] }).tags[0] = "input mutation";
      (original.result.nodeMap?.get(1) as { type: string }).type = "input mutation";

      const first = await store.get("page");
      assertEquals(first?.result.html, "<h1>Original</h1>");
      assertEquals(
        (first?.result.frontmatter as { tags: string[] }).tags[0],
        "Original",
      );
      assertEquals((first?.result.nodeMap?.get(1) as { type: string }).type, "heading");
      if (first) {
        (first.result.frontmatter as { tags: string[] }).tags[0] = "output mutation";
        (first.result.nodeMap?.get(1) as { type: string }).type = "output mutation";
      }

      const second = await store.get("page");
      assertEquals(
        (second?.result.frontmatter as { tags: string[] }).tags[0],
        "Original",
      );
      assertEquals((second?.result.nodeMap?.get(1) as { type: string }).type, "heading");
      assertEquals(backend.getCount, 0);

      const serialized = parseCachePayload(JSON.parse(backend.values.get("page")!));
      assertEquals(serialized?.nodeMapEntries, [[1, { type: "heading" }]]);
      assertEquals(
        (serialized?.result.nodeMap?.get(1) as { type: string }).type,
        "heading",
      );
    });

    it("reads through and populates local cache when enabled", async () => {
      const backend = new FakeApiBackend();
      const writer = storeWith(backend, { enableLocalCache: false });
      await writer.set("page", payload("distributed"));

      const reader = storeWith(backend, { enableLocalCache: true });
      assertEquals((await reader.get("page"))?.result.html, "distributed");
      assertEquals((await reader.get("page"))?.result.html, "distributed");
      assertEquals(backend.getCount, 1);
    });

    it("evicts malformed distributed payloads", async () => {
      const backend = new FakeApiBackend();
      backend.values.set("broken-json", "{not-json");
      backend.values.set("broken-shape", JSON.stringify({ storedAt: "invalid" }));
      const store = storeWith(backend, { enableLocalCache: false });

      assertEquals(await store.get("broken-json"), undefined);
      assertEquals(await store.get("broken-shape"), undefined);
      assertEquals(backend.values.has("broken-json"), false);
      assertEquals(backend.values.has("broken-shape"), false);
    });

    it("propagates authoritative corruption-eviction failures", async () => {
      const backend = new FakeApiBackend();
      backend.values.set("broken", "{not-json");
      backend.failDelete = new Error("eviction unavailable");
      const store = storeWith(backend, { enableLocalCache: false });

      await assertRejects(() => store.get("broken"), Error, "eviction unavailable");
      assertEquals(backend.values.has("broken"), true);
    });

    it("fails reads open when the distributed backend is unavailable", async () => {
      const backend = new FakeApiBackend();
      backend.failGet = new Error("read unavailable");
      const store = storeWith(backend, { enableLocalCache: false });

      assertEquals(await store.get("page"), undefined);
    });

    it("commits distributed writes before exposing them locally", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      await store.set("page", payload("old"));
      backend.failSet = new Error("write unavailable");

      await assertRejects(() => store.set("page", payload("new")), Error, "write unavailable");

      assertEquals((await store.get("page"))?.result.html, "old");
      assertEquals(
        parseCachePayload(JSON.parse(backend.values.get("page")!))?.result.html,
        "old",
      );
    });

    it("rejects streams instead of reporting a successful no-op", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      const streamed = payload("stream");
      streamed.result.stream = new ReadableStream();

      await assertRejects(() => store.set("stream", streamed), TypeError, "stream");
      assertEquals(backend.values.has("stream"), false);
    });

    it("extends the authoritative TTL through staleUntil", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend, { ttlSeconds: 5 });
      const staleUntil = Date.now() + 60_000;

      await store.set(
        "page",
        payload("stale", {
          expiresAt: Date.now() + 5_000,
          staleUntil,
        }),
      );

      assertEquals(backend.setTtls.length, 1);
      assertEquals(backend.setTtls[0]! > 5, true);
    });

    it("retains local stale data for the full stale window", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend, { ttlSeconds: 1 });
      const originalNow = Date.now;
      let now = 10_000;
      Date.now = () => now;
      try {
        await store.set(
          "page",
          payload("stale", {
            storedAt: now,
            expiresAt: now + 500,
            staleUntil: now + 60_000,
          }),
        );
        backend.values.delete("page");
        now += 2_000;

        assertEquals((await store.get("page"))?.result.html, "stale");
        assertEquals(backend.getCount, 0);
      } finally {
        Date.now = originalNow;
      }
    });

    it("turns an already-retention-expired write into a delete", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      await store.set("page", payload("old"));
      const setCount = backend.setTtls.length;
      const now = Date.now();

      await store.set(
        "page",
        payload("expired", { storedAt: now - 2, expiresAt: now - 1 }),
      );

      assertEquals(backend.values.has("page"), false);
      assertEquals(backend.setTtls.length, setCount);
      assertEquals(store.getStats().size, 0);
    });
  });

  describe("initialization and invalidation", () => {
    it("singleflights concurrent initialization", async () => {
      const opening = deferred<CacheBackend>();
      const backend = new FakeApiBackend();
      let opens = 0;
      const store = new APICacheStore({
        enableLocalCache: false,
        backendFactory: () => {
          opens++;
          return opening.promise;
        },
      });

      const first = store.get("a");
      const second = store.get("b");
      await Promise.resolve();
      assertEquals(opens, 1);
      opening.resolve(backend);
      await Promise.all([first, second]);
      assertEquals(opens, 1);
    });

    it("resets a rejected initialization promise and recovers", async () => {
      const backend = new FakeApiBackend();
      let opens = 0;
      const store = new APICacheStore({
        backendFactory: () => {
          opens++;
          return opens === 1 ? Promise.reject(new Error("init failed")) : Promise.resolve(backend);
        },
      });

      await assertRejects(() => store.set("page", payload("first")), Error, "init failed");
      await store.set("page", payload("recovered"));
      assertEquals(opens, 2);
      assertEquals((await store.get("page"))?.result.html, "recovered");
    });

    it("propagates delete failures while removing stale local copies", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      await store.set("page", payload("value"));
      backend.failDelete = new Error("delete unavailable");

      await assertRejects(() => store.delete("page"), Error, "delete unavailable");
      assertEquals(store.getStats().size, 0);
    });

    it("clears distributed and local entries by prefix and namespace", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      await store.set("project:a", payload("a"));
      await store.set("project:b", payload("b"));
      await store.set("other:c", payload("c"));

      assertEquals(await store.deleteByPrefix("project:"), 4);
      assertEquals(backend.values.has("project:a"), false);
      assertEquals(backend.values.has("other:c"), true);

      await store.clear();
      assertEquals(backend.patterns.at(-1), "*");
      assertEquals(backend.values.size, 0);
      assertEquals(store.getStats().size, 0);
    });

    it("escapes glob metacharacters when deleting a literal prefix", async () => {
      const backend = new FakeApiBackend();
      const store = storeWith(backend);
      const prefix = "route:[slug]?*\\";
      await store.set(`${prefix}page`, payload("match"));
      await store.set("route:other", payload("keep"));

      assertEquals(await store.deleteByPrefix(prefix), 2);
      assertEquals(backend.patterns.at(-1), `${escapeRedisCacheGlobLiteral(prefix)}*`);
      assertEquals(backend.values.has(`${prefix}page`), false);
      assertEquals(backend.values.has("route:other"), true);
    });

    it("rejects unsupported and failed distributed bulk invalidation", async () => {
      const backend = new FakeApiBackend();
      const withoutPattern = new Proxy(backend, {
        get(target, property) {
          if (property === "delByPattern") return undefined;
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as CacheBackend;
      const unsupportedStore = storeWith(withoutPattern);
      await unsupportedStore.set("page", payload("value"));
      await assertRejects(
        () => unsupportedStore.clear(),
        TypeError,
        "does not support clearing",
      );
      assertEquals(unsupportedStore.getStats().size, 0);

      const failingBackend = new FakeApiBackend();
      const failingStore = storeWith(failingBackend);
      await failingStore.set("project:a", payload("value"));
      failingBackend.failPatternDelete = new Error("bulk delete unavailable");
      await assertRejects(
        () => failingStore.deleteByPrefix("project:"),
        Error,
        "bulk delete unavailable",
      );
      assertEquals(failingStore.getStats().size, 0);
    });

    it("rejects operations after destroy", async () => {
      const store = storeWith(new FakeApiBackend());
      await store.destroy();
      await store.destroy();

      await assertRejects(() => store.get("page"), Error, "has been destroyed");
      await assertRejects(() => store.set("page", payload("value")), Error, "has been destroyed");
      await assertRejects(() => store.delete("page"), Error, "has been destroyed");
    });
  });
});
