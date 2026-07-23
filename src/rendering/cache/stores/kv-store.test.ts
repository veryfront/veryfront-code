import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CachePayload } from "../types.ts";
import { KVCacheStore } from "./kv-store.ts";

function payload(html: string): CachePayload {
  return {
    result: { html, frontmatter: {}, headings: [], stream: null },
    storedAt: Date.now(),
  };
}

interface FakeKV {
  values: Map<string, { key: unknown[]; value: unknown }>;
  closeCount: number;
  get<T>(key: unknown[]): Promise<{ value: T | null }>;
  set(key: unknown[], value: unknown, options?: { expireIn?: number }): Promise<void>;
  delete(key: unknown[]): Promise<void>;
  list(selector: { prefix: unknown[] }): AsyncIterable<{ key: unknown[] }>;
  close(): Promise<void>;
}

function keyId(key: unknown[]): string {
  return JSON.stringify(key);
}

function startsWithKey(key: unknown[], prefix: unknown[]): boolean {
  return prefix.every((part, index) => key[index] === part);
}

function createFakeKV(): FakeKV {
  const kv: FakeKV = {
    values: new Map(),
    closeCount: 0,
    get<T>(key: unknown[]): Promise<{ value: T | null }> {
      return Promise.resolve({ value: (kv.values.get(keyId(key))?.value as T) ?? null });
    },
    set(key: unknown[], value: unknown, _options?: { expireIn?: number }): Promise<void> {
      kv.values.set(keyId(key), { key: [...key], value });
      return Promise.resolve();
    },
    delete(key: unknown[]): Promise<void> {
      kv.values.delete(keyId(key));
      return Promise.resolve();
    },
    async *list(selector: { prefix: unknown[] }): AsyncIterable<{ key: unknown[] }> {
      for (const entry of [...kv.values.values()]) {
        if (startsWithKey(entry.key, selector.prefix)) yield { key: [...entry.key] };
      }
    },
    close(): Promise<void> {
      kv.closeCount++;
      return Promise.resolve();
    },
  };
  return kv;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("rendering/cache/stores/kv-store", () => {
  it("creates with default and custom paths", () => {
    assertEquals(new KVCacheStore() instanceof KVCacheStore, true);
    assertEquals(new KVCacheStore({ path: "/tmp/test.db" }) instanceof KVCacheStore, true);
  });

  it("sets, gets, deletes, and clears its namespace", async () => {
    const kv = createFakeKV();
    const store = new KVCacheStore({ openKv: () => Promise.resolve(kv) });

    assertEquals(await store.get("missing"), undefined);
    await store.set("project:a", payload("a"));
    await store.set("project:b", payload("b"));
    await store.set("other:c", payload("c"));
    assertEquals((await store.get("project:a"))?.result.html, "a");

    assertEquals(await store.deleteByPrefix("project:"), 2);
    assertEquals(await store.get("project:a"), undefined);
    assertEquals((await store.get("other:c"))?.result.html, "c");

    await store.delete("other:c");
    await store.delete("missing");
    await store.set("final", payload("final"));
    await store.clear();
    assertEquals(await store.get("final"), undefined);
  });

  it("sets a physical expiry that retains the complete stale window", async () => {
    const kv = createFakeKV();
    let expireIn: number | undefined;
    const baseSet = kv.set.bind(kv);
    kv.set = (key, value, options) => {
      expireIn = options?.expireIn;
      return baseSet(key, value, options);
    };
    const store = new KVCacheStore({
      ttlMs: 1_000,
      openKv: () => Promise.resolve(kv),
    });

    await store.set("stale-window", {
      ...payload("stale"),
      expiresAt: Date.now() + 500,
      staleUntil: Date.now() + 10_000,
    });

    assertEquals((expireIn ?? 0) >= 9_000, true);
  });

  it("turns an already-retention-expired write into a delete", async () => {
    const kv = createFakeKV();
    const store = new KVCacheStore({ openKv: () => Promise.resolve(kv) });
    await store.set("page", payload("old"));
    const now = Date.now();

    await store.set("page", {
      ...payload("expired"),
      storedAt: now - 2,
      expiresAt: now - 1,
    });

    assertEquals(await store.get("page"), undefined);
  });

  it("opens exactly one handle for concurrent first operations", async () => {
    const opening = deferred<unknown>();
    const kv = createFakeKV();
    let opens = 0;
    const store = new KVCacheStore({
      openKv: () => {
        opens++;
        return opening.promise;
      },
    });

    const get = store.get("page");
    const set = store.set("page", payload("value"));
    assertEquals(opens, 1);
    opening.resolve(kv);

    await Promise.all([get, set]);
    assertEquals(opens, 1);
    assertEquals((await store.get("page"))?.result.html, "value");
  });

  it("resets failed initialization so a later operation can recover", async () => {
    const kv = createFakeKV();
    let opens = 0;
    const store = new KVCacheStore({
      openKv: () => {
        opens++;
        return opens === 1
          ? Promise.reject(new Error("temporarily unavailable"))
          : Promise.resolve(kv);
      },
    });

    await assertRejects(() => store.get("page"), Error, "temporarily unavailable");
    await store.set("page", payload("recovered"));

    assertEquals(opens, 2);
    assertEquals((await store.get("page"))?.result.html, "recovered");
  });

  it("closes malformed instances and retries instead of caching failure", async () => {
    let closed = 0;
    let opens = 0;
    const kv = createFakeKV();
    const store = new KVCacheStore({
      openKv: () => {
        opens++;
        return Promise.resolve(
          opens === 1 ? { get: () => Promise.resolve({ value: null }), close: () => closed++ } : kv,
        );
      },
    });

    await assertRejects(() => store.get("page"), TypeError, "invalid KV instance");
    assertEquals(closed, 1);
    await store.set("page", payload("recovered"));
    assertEquals(opens, 2);
  });

  it("fails explicitly when the configured backend cannot open", async () => {
    const unavailable = new Error("KV unavailable");
    const store = new KVCacheStore({ openKv: () => Promise.reject(unavailable) });

    await assertRejects(() => store.get("page"), Error, "KV unavailable");
    await assertRejects(() => store.set("page", payload("value")), Error, "KV unavailable");
    await assertRejects(() => store.delete("page"), Error, "KV unavailable");
  });

  it("rejects unsupported or untrusted bulk invalidation", async () => {
    const withoutList = createFakeKV();
    const { list: _list, ...incomplete } = withoutList;
    const missingListStore = new KVCacheStore({ openKv: () => Promise.resolve(incomplete) });

    await assertRejects(
      () => missingListStore.deleteByPrefix("project:"),
      TypeError,
      "does not support prefix invalidation",
    );
    await assertRejects(
      () => missingListStore.clear(),
      TypeError,
      "does not support clearing",
    );

    const malformedList = createFakeKV();
    malformedList.list = async function* () {
      yield { key: ["someone-else", "data", "page"] };
    };
    const malformedStore = new KVCacheStore({ openKv: () => Promise.resolve(malformedList) });
    await assertRejects(
      () => malformedStore.clear(),
      TypeError,
      "outside the render cache namespace",
    );
  });

  it("evicts malformed payloads from the authoritative KV store", async () => {
    const kv = createFakeKV();
    await kv.set(["veryfront", "render", "broken"], { storedAt: "not-a-number" });
    const store = new KVCacheStore({ openKv: () => Promise.resolve(kv) });

    assertEquals(await store.get("broken"), undefined);
    assertEquals(kv.values.has(keyId(["veryfront", "render", "broken"])), false);
  });

  it("closes an in-flight handle exactly once when destroyed", async () => {
    const opening = deferred<unknown>();
    const kv = createFakeKV();
    const store = new KVCacheStore({ openKv: () => opening.promise });

    const get = store.get("page");
    const destroying = store.destroy();
    opening.resolve(kv);

    await assertRejects(() => get, Error, "destroyed during initialization");
    await destroying;
    await store.destroy();
    assertEquals(kv.closeCount, 1);
    await assertRejects(() => store.get("page"), Error, "has been destroyed");
  });
});
