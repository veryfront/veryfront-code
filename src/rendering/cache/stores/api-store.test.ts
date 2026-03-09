import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { APICacheStore } from "./api-store.ts";

describe("rendering/cache/stores/api-store", () => {
  describe("APICacheStore constructor", () => {
    it("should create with default options", () => {
      const store = new APICacheStore();
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom keyPrefix", () => {
      const store = new APICacheStore({ keyPrefix: "custom" });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom ttlSeconds", () => {
      const store = new APICacheStore({ ttlSeconds: 7200 });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with local cache disabled", () => {
      const store = new APICacheStore({ enableLocalCache: false });
      assertEquals(store instanceof APICacheStore, true);
    });

    it("should create with custom localMaxEntries", () => {
      const store = new APICacheStore({ localMaxEntries: 50 });
      assertEquals(store instanceof APICacheStore, true);
    });
  });

  describe("operations (without distributed backend)", () => {
    it("should return undefined for missing key", async () => {
      const store = new APICacheStore();
      const result = await store.get("missing-key");
      assertEquals(result, undefined);
    });

    it("should clear without error", async () => {
      const store = new APICacheStore();
      await store.clear();
    });

    it("should destroy without error", async () => {
      const store = new APICacheStore();
      await store.destroy();
    });

    it("should delete without error", async () => {
      const store = new APICacheStore();
      await store.delete("some-key");
    });
  });
});
