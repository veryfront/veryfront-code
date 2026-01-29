import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RedisBundleManifestStore } from "./bundle-manifest-redis.ts";

describe("RedisBundleManifestStore", () => {
  it("should construct without errors", () => {
    const store = new RedisBundleManifestStore({});
    assertEquals(typeof store, "object");
  });

  it("should construct with options", () => {
    const store = new RedisBundleManifestStore({
      url: "redis://localhost:6379",
      keyPrefix: "test:",
    });
    assertEquals(typeof store, "object");
  });

  it("should accept adapter as second argument", () => {
    const store = new RedisBundleManifestStore({}, { some: "adapter" });
    assertEquals(typeof store, "object");
  });

  describe("isAvailable", () => {
    it("should return false (placeholder implementation)", async () => {
      const store = new RedisBundleManifestStore({});
      const available = await store.isAvailable();
      assertEquals(available, false);
    });
  });

  describe("unimplemented methods", () => {
    const store = new RedisBundleManifestStore({});

    it("getBundleMetadata should reject with not implemented error", async () => {
      await assertRejects(
        () => store.getBundleMetadata("test-key"),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("setBundleMetadata should reject with not implemented error", async () => {
      await assertRejects(
        () =>
          store.setBundleMetadata("test-key", {
            hash: "abc",
            codeHash: "abc",
            size: 100,
            compiledAt: Date.now(),
            source: "test.ts",
            mode: "development",
          }),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("getBundleCode should reject with not implemented error", async () => {
      await assertRejects(
        () => store.getBundleCode("hash"),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("setBundleCode should reject with not implemented error", async () => {
      await assertRejects(
        () => store.setBundleCode("hash", { code: "", sourceMap: undefined }),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("deleteBundle should reject with not implemented error", async () => {
      await assertRejects(
        () => store.deleteBundle("key"),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("invalidateSource should reject with not implemented error", async () => {
      await assertRejects(
        () => store.invalidateSource("source"),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("clear should reject with not implemented error", async () => {
      await assertRejects(
        () => store.clear(),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });

    it("getStats should reject with not implemented error", async () => {
      await assertRejects(
        () => store.getStats(),
        Error,
        "Redis bundle manifest store not implemented",
      );
    });
  });
});
