import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CloudflareKVStoreAdapter } from "./kv.ts";
import type {
  KVGetOptions,
  KVGetWithMetadataResult,
  KVListKey,
  KVListOptions,
  KVListResult,
  KVNamespace,
  KVPutOptions,
  KVValueForType,
  KVValueType,
} from "./types.ts";

class MemoryKV implements KVNamespace {
  readonly values = new Map<string, string>();
  readonly puts: Array<{ key: string; value: string; options?: KVPutOptions }> = [];

  get<Type extends KVValueType = "text">(
    key: string,
    _typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVValueForType<Type> | null> {
    return Promise.resolve((this.values.get(key) ?? null) as KVValueForType<Type> | null);
  }

  put(key: string, value: string | ArrayBuffer, options?: KVPutOptions): Promise<void> {
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    this.values.set(key, text);
    this.puts.push({ key, value: text, ...(options ? { options } : {}) });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  list(options?: KVListOptions): Promise<KVListResult> {
    const prefix = options?.prefix ?? "";
    const offset = Number(options?.cursor ?? 0);
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort();
    const nextOffset = Math.min(offset + 2, keys.length);
    const pageKeys = keys.slice(offset, nextOffset).map((name) => ({ name }));
    if (nextOffset >= keys.length) {
      return Promise.resolve({ keys: pageKeys, list_complete: true });
    }
    return Promise.resolve({
      keys: pageKeys,
      list_complete: false,
      cursor: String(nextOffset),
    });
  }

  getWithMetadata<Type extends KVValueType = "text">(
    key: string,
    _typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVGetWithMetadataResult<KVValueForType<Type>>> {
    return Promise.resolve({
      value: (this.values.get(key) ?? null) as KVValueForType<Type> | null,
      metadata: null,
    });
  }
}

class RepeatingCursorKV extends MemoryKV {
  override list(_options?: KVListOptions): Promise<KVListResult> {
    const keys: KVListKey[] = [];
    return Promise.resolve({ keys, list_complete: false, cursor: "same" });
  }
}

class EmptyFirstPageKV extends MemoryKV {
  override list(options?: KVListOptions): Promise<KVListResult> {
    if (!options?.cursor) {
      return Promise.resolve({ keys: [], list_complete: false, cursor: "next" });
    }
    const prefix = options.prefix ?? "";
    return Promise.resolve({
      keys: [...this.values.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((name) => ({ name })),
      list_complete: true,
    });
  }
}

class FailingKV extends MemoryKV {
  override get<Type extends KVValueType = "text">(
    _key: string,
    _typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVValueForType<Type> | null> {
    return Promise.reject(new Error("provider leaked sensitive-key"));
  }
}

describe("CloudflareKVStoreAdapter", () => {
  it("supports CRUD operations and forwards expiration TTL", async () => {
    const namespace = new MemoryKV();
    const adapter = new CloudflareKVStoreAdapter(namespace);

    await adapter.set("session", "value", { expirationTtl: 120 });
    assertEquals(await adapter.get("session"), "value");
    assertEquals(namespace.puts, [{
      key: "session",
      value: "value",
      options: { expirationTtl: 120 },
    }]);

    await adapter.delete("session");
    assertEquals(await adapter.get("session"), null);
  });

  it("rejects invalid keys and TTL values before calling the namespace", async () => {
    const namespace = new MemoryKV();
    const adapter = new CloudflareKVStoreAdapter(namespace);

    for (const key of ["", ".", ".."]) {
      await assertRejects(() => adapter.set(key, "value"), Error, "key is invalid");
    }
    await assertRejects(
      () => adapter.set("session", "value", { expirationTtl: 59 }),
      Error,
      "at least 60 seconds",
    );
    assertEquals(namespace.puts, []);
  });

  it("lists every matching key across paginated and empty pages", async () => {
    const namespace = new EmptyFirstPageKV();
    namespace.values.set("cache:a", "a");
    namespace.values.set("cache:b", "b");
    namespace.values.set("cache:c", "c");
    namespace.values.set("other", "other");
    const adapter = new CloudflareKVStoreAdapter(namespace);
    const keys: string[] = [];

    for await (const key of adapter.list("cache:")) keys.push(key);

    assertEquals(keys, ["cache:a", "cache:b", "cache:c"]);
  });

  it("accepts a completed Workers KV page without a cursor", async () => {
    const adapter = new CloudflareKVStoreAdapter(new MemoryKV());
    const keys: string[] = [];

    for await (const key of adapter.list()) keys.push(key);

    assertEquals(keys, []);
  });

  it("rejects malformed pagination instead of looping forever", async () => {
    const adapter = new CloudflareKVStoreAdapter(new RepeatingCursorKV());

    await assertRejects(
      async () => {
        for await (const _key of adapter.list()) {
          // The malformed namespace produces no keys.
        }
      },
      Error,
      "cursor",
    );
  });

  it("sanitizes provider failures", async () => {
    const adapter = new CloudflareKVStoreAdapter(new FailingKV());

    const error = await assertRejects(
      () => adapter.get("sensitive-key"),
      Error,
      "operation failed",
    );
    assert(error instanceof Error);
    assertEquals(error.message.includes("sensitive-key"), false);
  });
});
