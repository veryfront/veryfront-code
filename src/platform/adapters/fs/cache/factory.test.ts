import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createFileCache } from "./factory.ts";
import { FileCache } from "./file-cache.ts";

describe("createFileCache", () => {
  it("should export createFileCache function", () => {
    assertExists(createFileCache);
    assertEquals(typeof createFileCache, "function");
  });

  it("should create a FileCache instance with default options", () => {
    const cache = createFileCache();
    assertExists(cache);
    assertEquals(cache instanceof FileCache, true);
  });

  it("should create a FileCache instance with custom options", () => {
    const cache = createFileCache({
      maxSize: 1000,
      ttl: 60000,
    });
    assertExists(cache);
    assertEquals(cache instanceof FileCache, true);
  });

  it("should create independent cache instances", () => {
    const cache1 = createFileCache();
    const cache2 = createFileCache();
    assertEquals(cache1 !== cache2, true);
  });
});
