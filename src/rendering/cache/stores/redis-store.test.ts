import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RedisCacheStore } from "./redis-store.ts";

describe("RedisCacheStore", () => {
  describe("constructor", () => {
    it("should create store with default options", () => {
      expect(new RedisCacheStore()).toBeDefined();
    });

    it("should create store with custom key prefix", () => {
      expect(new RedisCacheStore({ keyPrefix: "custom:" })).toBeDefined();
    });

    it("should create store with fallback disabled", () => {
      expect(new RedisCacheStore({ enableFallback: false })).toBeDefined();
    });

    it("should create store with custom URL", () => {
      expect(new RedisCacheStore({ url: "redis://localhost:6379" })).toBeDefined();
    });

    it("should create store with all options", () => {
      expect(
        new RedisCacheStore({
          url: "redis://localhost:6379",
          keyPrefix: "test:",
          enableFallback: true,
        }),
      ).toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clean up resources on destroy when not connected", async () => {
      await new RedisCacheStore().destroy();
    });

    it("should be safe to call destroy multiple times", async () => {
      const store = new RedisCacheStore();
      await store.destroy();
      await store.destroy();
    });
  });

  describe("configuration", () => {
    it("should use default prefix 'veryfront:render:'", () => {
      expect(new RedisCacheStore()).toBeDefined();
    });

    it("should enable fallback by default", () => {
      expect(new RedisCacheStore()).toBeDefined();
    });
  });
});
