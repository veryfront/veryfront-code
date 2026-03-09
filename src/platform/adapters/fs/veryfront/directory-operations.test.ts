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

  describe("readdir with mock data", () => {
    function createDirOpsWithFiles(
      files: Array<{ path: string; type?: string }>,
    ): DirectoryOperations {
      const mockClient = {
        getRequestBranch: () => "main",
        listAllFiles: () => Promise.resolve(files),
        listPublishedFiles: () => Promise.resolve(files),
      } as any;

      const cache = new FileCache({ enabled: true, ttl: 60000, maxSize: 100 });
      const normalizer = new PathNormalizer();
      return new DirectoryOperations(mockClient, cache, normalizer);
    }

    it("should return empty array for empty project", async () => {
      const dirOps = createDirOpsWithFiles([]);
      const entries = await dirOps.readdir("");
      assertEquals(entries.length, 0);
    });

    it("should list root-level files", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "index.tsx" },
        { path: "about.tsx" },
      ]);

      const entries = await dirOps.readdir("");
      assertEquals(entries.length, 2);
      const names = entries.map((e) => e.name).sort();
      assertEquals(names, ["about.tsx", "index.tsx"]);
      assertEquals(entries.every((e) => e.isFile), true);
      assertEquals(entries.every((e) => !e.isDirectory), true);
    });

    it("should list directories at root level", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "pages/index.tsx" },
        { path: "pages/about.tsx" },
        { path: "components/button.tsx" },
      ]);

      const entries = await dirOps.readdir("");
      const dirEntries = entries.filter((e) => e.isDirectory);
      const dirNames = dirEntries.map((e) => e.name).sort();
      assertEquals(dirNames, ["components", "pages"]);
    });

    it("should list files within a subdirectory", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "pages/index.tsx" },
        { path: "pages/about.tsx" },
        { path: "pages/nested/deep.tsx" },
      ]);

      const entries = await dirOps.readdir("pages");
      const names = entries.map((e) => e.name).sort();
      assertEquals(names, ["about.tsx", "index.tsx", "nested"]);
    });

    it("should return empty for non-existent directory", async () => {
      const dirOps = createDirOpsWithFiles([{ path: "pages/index.tsx" }]);
      const entries = await dirOps.readdir("nonexistent");
      assertEquals(entries.length, 0);
    });

    it("should handle trailing slash paths", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "pages/", type: "page" },
      ]);

      const entries = await dirOps.readdir("pages");
      assertEquals(entries.length, 1);
      assertEquals(entries[0].name, "index.mdx");
    });

    it("should cache readdir results", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "index.tsx" },
      ]);

      const entries1 = await dirOps.readdir("");
      const entries2 = await dirOps.readdir("");
      assertEquals(entries1.length, entries2.length);
    });

    it("should clear tree on clearTree call", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "index.tsx" },
      ]);

      await dirOps.readdir(""); // build tree
      dirOps.clearTree(); // clear it
      // Should rebuild on next call
      const entries = await dirOps.readdir("");
      assertEquals(entries.length, 1);
    });

    it("should normalize leading slashes", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "/pages/index.tsx" },
      ]);

      const entries = await dirOps.readdir("pages");
      assertEquals(entries.length, 1);
      assertEquals(entries[0].name, "index.tsx");
    });

    it("should handle deeply nested files", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "a/b/c/d/file.tsx" },
      ]);

      const rootEntries = await dirOps.readdir("");
      assertEquals(rootEntries.length, 1);
      assertEquals(rootEntries[0].name, "a");
      assertEquals(rootEntries[0].isDirectory, true);

      const aEntries = await dirOps.readdir("a");
      assertEquals(aEntries.length, 1);
      assertEquals(aEntries[0].name, "b");

      const deepEntries = await dirOps.readdir("a/b/c/d");
      assertEquals(deepEntries.length, 1);
      assertEquals(deepEntries[0].name, "file.tsx");
      assertEquals(deepEntries[0].isFile, true);
    });
  });
});
