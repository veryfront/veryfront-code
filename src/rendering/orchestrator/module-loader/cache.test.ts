import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEsmCache, createModuleCache, generateHash } from "./cache.ts";

describe("module-loader/cache", () => {
  describe("generateHash", () => {
    it("should produce a 16-character hex string", async () => {
      const hash = await generateHash("hello world");
      assertEquals(hash.length, 16);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should produce deterministic output", async () => {
      const a = await generateHash("test input");
      const b = await generateHash("test input");
      assertEquals(a, b);
    });

    it("should produce different hashes for different inputs", async () => {
      const a = await generateHash("input one");
      const b = await generateHash("input two");
      assertEquals(a !== b, true);
    });

    it("should handle empty string", async () => {
      const hash = await generateHash("");
      assertEquals(hash.length, 16);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });

    it("should handle long strings", async () => {
      const longStr = "x".repeat(100000);
      const hash = await generateHash(longStr);
      assertEquals(hash.length, 16);
    });

    it("should handle unicode content", async () => {
      const hash = await generateHash("Hello");
      assertEquals(hash.length, 16);
      assertEquals(/^[0-9a-f]+$/.test(hash), true);
    });
  });

  describe("createModuleCache", () => {
    it("should return a Map-compatible object", () => {
      const cache = createModuleCache();
      // Pod-level caches may wrap Map, so check for Map-like interface
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
      assertEquals(typeof cache.has, "function");
      assertEquals(typeof cache.delete, "function");
    });

    it("should support basic get/set operations", () => {
      const cache = createModuleCache();
      cache.set("key", "value");
      assertEquals(cache.get("key"), "value");
    });

    it("should support has operation", () => {
      const cache = createModuleCache();
      cache.set("exists", "yes");
      assertEquals(cache.has("exists"), true);
      assertEquals(cache.has("nope"), false);
    });

    it("should support delete operation", () => {
      const cache = createModuleCache();
      cache.set("to-delete", "value");
      cache.delete("to-delete");
      assertEquals(cache.has("to-delete"), false);
    });
  });

  describe("createEsmCache", () => {
    it("should return a Map-compatible object", () => {
      const cache = createEsmCache();
      assertEquals(typeof cache.get, "function");
      assertEquals(typeof cache.set, "function");
      assertEquals(typeof cache.has, "function");
      assertEquals(typeof cache.delete, "function");
    });

    it("should support basic get/set operations", () => {
      const cache = createEsmCache();
      cache.set("url", "/tmp/module.js");
      assertEquals(cache.get("url"), "/tmp/module.js");
    });

    it("should support has operation", () => {
      const cache = createEsmCache();
      cache.set("test-url", "/path");
      assertEquals(cache.has("test-url"), true);
    });
  });
});
