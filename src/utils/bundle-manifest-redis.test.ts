import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisBundleManifestStore } from "./bundle-manifest-redis.ts";

const NOT_IMPLEMENTED_MESSAGE = "Redis bundle manifest store not implemented";

describe("RedisBundleManifestStore", () => {
  it("should construct without errors", () => {
    assertEquals(typeof new RedisBundleManifestStore({}), "object");
  });

  it("should construct with options", () => {
    assertEquals(
      typeof new RedisBundleManifestStore({
        url: "redis://localhost:6379",
        keyPrefix: "test:",
      }),
      "object",
    );
  });

  it("should accept adapter as second argument", () => {
    assertEquals(
      typeof new RedisBundleManifestStore({}, { some: "adapter" }),
      "object",
    );
  });

  describe("isAvailable", () => {
    it("should return false (placeholder implementation)", async () => {
      const store = new RedisBundleManifestStore({});
      assertEquals(await store.isAvailable(), false);
    });
  });

  describe("unimplemented methods", () => {
    const store = new RedisBundleManifestStore({});

    async function assertNotImplemented(fn: () => Promise<unknown>): Promise<void> {
      await assertRejects(fn, Error, NOT_IMPLEMENTED_MESSAGE);
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
