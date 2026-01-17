import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createFileCache, estimateSize, FileCache, LRUTracker } from "./index.ts";

describe("fs/cache/index.ts exports", () => {
  describe("FileCache", () => {
    it("should export FileCache class", () => {
      assertExists(FileCache);
      assertEquals(typeof FileCache, "function");
    });
  });

  describe("createFileCache", () => {
    it("should export createFileCache function", () => {
      assertExists(createFileCache);
      assertEquals(typeof createFileCache, "function");
    });
  });

  describe("estimateSize", () => {
    it("should export estimateSize function", () => {
      assertExists(estimateSize);
      assertEquals(typeof estimateSize, "function");
    });
  });

  describe("LRUTracker", () => {
    it("should export LRUTracker class", () => {
      assertExists(LRUTracker);
      assertEquals(typeof LRUTracker, "function");
    });
  });
});
