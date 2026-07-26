import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
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
      const [entry] = entries;
      assertExists(entry);
      assertEquals(entry.name, "index.mdx");
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

    it("should retry after a failed tree build", async () => {
      let attempts = 0;
      const client = {
        getRequestBranch: () => "main",
        listPublishedFiles: () => {
          attempts++;
          return attempts === 1
            ? Promise.reject(new Error("malformed file list"))
            : Promise.resolve([{ path: "recovered.tsx" }]);
        },
      } as any;
      const dirOps = new DirectoryOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 10 }),
        new PathNormalizer(),
      );

      await assertRejects(() => dirOps.readdir(""), Error, "malformed file list");
      assertEquals((await dirOps.readdir("")).map((entry) => entry.name), ["recovered.tsx"]);
      assertEquals(attempts, 2);
    });

    it("should discard an in-flight tree build after clearTree", async () => {
      let resolveFirst: ((files: Array<{ path: string }>) => void) | undefined;
      let attempts = 0;
      const client = {
        getRequestBranch: () => "main",
        listPublishedFiles: () => {
          attempts++;
          if (attempts === 1) {
            return new Promise<Array<{ path: string }>>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve([{ path: "fresh.tsx" }]);
        },
      } as any;
      const dirOps = new DirectoryOperations(
        client,
        new FileCache({ enabled: false, ttl: 1000, maxSize: 10 }),
        new PathNormalizer(),
      );

      const pendingRead = dirOps.readdir("");
      for (let index = 0; index < 10 && resolveFirst === undefined; index++) {
        await Promise.resolve();
      }
      assertExists(resolveFirst);
      dirOps.clearTree();
      resolveFirst?.([{ path: "stale.tsx" }]);

      assertEquals((await pendingRead).map((entry) => entry.name), ["fresh.tsx"]);
      assertEquals(attempts, 2);
    });

    it("should normalize leading slashes", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "/pages/index.tsx" },
      ]);

      const entries = await dirOps.readdir("pages");
      assertEquals(entries.length, 1);
      const [entry] = entries;
      assertExists(entry);
      assertEquals(entry.name, "index.tsx");
    });

    it("should handle deeply nested files", async () => {
      const dirOps = createDirOpsWithFiles([
        { path: "a/b/c/d/file.tsx" },
      ]);

      const rootEntries = await dirOps.readdir("");
      assertEquals(rootEntries.length, 1);
      const [rootEntry] = rootEntries;
      assertExists(rootEntry);
      assertEquals(rootEntry.name, "a");
      assertEquals(rootEntry.isDirectory, true);

      const aEntries = await dirOps.readdir("a");
      assertEquals(aEntries.length, 1);
      const [aEntry] = aEntries;
      assertExists(aEntry);
      assertEquals(aEntry.name, "b");

      const deepEntries = await dirOps.readdir("a/b/c/d");
      assertEquals(deepEntries.length, 1);
      const [deepEntry] = deepEntries;
      assertExists(deepEntry);
      assertEquals(deepEntry.name, "file.tsx");
      assertEquals(deepEntry.isFile, true);
    });
  });
});
