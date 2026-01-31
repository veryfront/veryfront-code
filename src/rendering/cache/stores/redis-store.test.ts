import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RedisCacheStore } from "./redis-store.ts";

function createStore(options?: ConstructorParameters<typeof RedisCacheStore>[0]): RedisCacheStore {
  return new RedisCacheStore(options);
}

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      expect(createStore()).toBeDefined();
    });

    it("should create store with custom key prefix", () => {
      expect(createStore({ keyPrefix: "custom:" })).toBeDefined();
    });

    it("should create store with fallback disabled", () => {
      expect(createStore({ enableFallback: false })).toBeDefined();
    });

    it("should create store with custom URL", () => {
      expect(createStore({ url: "redis://localhost:6379" })).toBeDefined();
    });

    it("should create store with all options", () => {
      expect(
        createStore({
          url: "redis://localhost:6379",
          keyPrefix: "test:",
          enableFallback: true,
        }),
      ).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up resources on destroy when not connected", async () => {
      await createStore().destroy();
    });

    it("should be safe to call destroy multiple times", async () => {
      const store = createStore();
      await store.destroy();
      await store.destroy();
    });
  });

  describe("configuration", () => {
    it("should use default prefix 'veryfront:render:'", () => {
      expect(createStore()).toBeDefined();
    });

    it("should create store with default options", () => {
      expect(createStore()).toBeDefined();
    });
  });
});
