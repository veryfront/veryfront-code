import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { DirectoryOperations } from "./directory-operations.ts";
import { PathNormalizer } from "./path-normalizer.ts";
import { FileCache } from "../cache/file-cache.ts";

describe("DirectoryOperations", () => {
  describe("class", () => {
    it("should export DirectoryOperations class", () => {
      assertExists(DirectoryOperations);
      assertEquals(typeof DirectoryOperations, "function");
    });
  });

  describe("methods", () => {
    // Create minimal mock objects for testing class structure
    const mockClient = {
      getRequestBranch: () => "main",
      listAllFiles: () => Promise.resolve([]),
      listPublishedFiles: () => Promise.resolve([]),
    } as any;
    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    it("should be instantiable", () => {
      const dirOps = new DirectoryOperations(mockClient, cache, normalizer);
      assertExists(dirOps);
    });

    it("should have readdir method", () => {
      const dirOps = new DirectoryOperations(mockClient, cache, normalizer);
      assertExists(dirOps.readdir);
      assertEquals(typeof dirOps.readdir, "function");
    });

    it("should have clearTree method", () => {
      const dirOps = new DirectoryOperations(mockClient, cache, normalizer);
      assertExists(dirOps.clearTree);
      assertEquals(typeof dirOps.clearTree, "function");
    });

    it("should be callable to clear tree", () => {
      const dirOps = new DirectoryOperations(mockClient, cache, normalizer);
      // Should not throw
      dirOps.clearTree();
    });
  });
});
