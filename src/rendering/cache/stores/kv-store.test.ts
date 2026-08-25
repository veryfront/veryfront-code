import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { KVCacheStore } from "./kv-store.ts";

// KVCacheStore opens its handle lazily through Deno.openKv, so every behavioral
// case needs that runtime namespace stubbed. Those cases live in
// tests/integration/rendering/cache/kv-store.test.ts, where host effects are
// allowed; only construction is observable without touching the host.
describe("rendering/cache/stores/kv-store", () => {
  describe("KVCacheStore constructor", () => {
    it("constructs without opening a KV handle", () => {
      assertEquals(
        new KVCacheStore() instanceof KVCacheStore,
        true,
        "the default constructor must not need a KV implementation",
      );
      assertEquals(
        new KVCacheStore({ path: "test.db" }) instanceof KVCacheStore,
        true,
        "a custom path must not need a KV implementation at construction time",
      );
    });
  });
});
