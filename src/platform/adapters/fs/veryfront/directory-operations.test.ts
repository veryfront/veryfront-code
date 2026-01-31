import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileCache } from "../cache/file-cache.ts";
import { DirectoryOperations } from "./directory-operations.ts";
import { PathNormalizer } from "./path-normalizer.ts";

describe("DirectoryOperations", () => {
  it("should export DirectoryOperations class", () => {
    assertExists(DirectoryOperations);
    assertEquals(typeof DirectoryOperations, "function");
  });

  describe("methods", () => {
    const mockClient = {
      getRequestBranch: () => "main",
      listAllFiles: () => Promise.resolve([]),
      listPublishedFiles: () => Promise.resolve([]),
    } as any;

    const cache = new FileCache({ enabled: true, ttl: 1000, maxSize: 100 });
    const normalizer = new PathNormalizer();

    function createDirOps(): DirectoryOperations {
      return new DirectoryOperations(mockClient, cache, normalizer);
    }

    it("should be instantiable", () => {
      assertExists(createDirOps());
    });

    it("should have readdir method", () => {
      const dirOps = createDirOps();
      assertExists(dirOps.readdir);
      assertEquals(typeof dirOps.readdir, "function");
    });

    it("should have clearTree method", () => {
      const dirOps = createDirOps();
      assertExists(dirOps.clearTree);
      assertEquals(typeof dirOps.clearTree, "function");
    });

    it("should be callable to clear tree", () => {
      createDirOps().clearTree();
    });
  });
});
