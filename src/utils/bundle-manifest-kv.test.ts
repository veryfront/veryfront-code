import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { KVBundleManifestStore } from "./bundle-manifest-kv.ts";

describe("KVBundleManifestStore", () => {
  it("should construct without errors", () => {
    assertEquals(typeof new KVBundleManifestStore({}), "object");
  });

  it("should construct with keyPrefix option", () => {
    assertEquals(typeof new KVBundleManifestStore({ keyPrefix: "test:" }), "object");
  });

  describe("isAvailable", () => {
    it("should return false (placeholder implementation)", async () => {
      const store = new KVBundleManifestStore({});
      assertEquals(await store.isAvailable(), false);
    });
  });

  describe("unimplemented methods", () => {
    const store = new KVBundleManifestStore({});
    const notImplementedMessage = "KV bundle manifest store not implemented";

    async function assertNotImplemented(fn: () => Promise<unknown>): Promise<void> {
      await assertRejects(fn, Error, notImplementedMessage);
    }

    it("getBundleMetadata should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.getBundleMetadata("test-key"));
    });

    it("setBundleMetadata should reject with not implemented error", async () => {
      await assertNotImplemented(() =>
        store.setBundleMetadata("test-key", {
          hash: "abc",
          codeHash: "abc",
          size: 100,
          compiledAt: Date.now(),
          source: "test.ts",
          mode: "development",
        })
      );
    });

    it("getBundleCode should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.getBundleCode("hash"));
    });

    it("setBundleCode should reject with not implemented error", async () => {
      await assertNotImplemented(() =>
        store.setBundleCode("hash", { code: "", sourceMap: undefined })
      );
    });

    it("deleteBundle should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.deleteBundle("key"));
    });

    it("invalidateSource should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.invalidateSource("source"));
    });

    it("clear should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.clear());
    });

    it("getStats should reject with not implemented error", async () => {
      await assertNotImplemented(() => store.getStats());
    });
  });
});
