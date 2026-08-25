import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubDirectoryOperations } from "./directory-operations.ts";
import { FileCache } from "../cache/file-cache.ts";

describe("GitHubDirectoryOperations", () => {
  const mockConfig = {
    owner: "test-owner",
    repo: "test-repo",
    ref: "main",
    token: "test-token",
    basePath: "",
    retry: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
    },
    cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
  };

  const mockStatOps = {
    isDirectory: (_path: string) => false,
    getFilesInDirectory: (_path: string) => [],
    getSubdirectories: (_path: string) => [],
  };

  function createOps(): GitHubDirectoryOperations {
    return new GitHubDirectoryOperations(
      mockConfig,
      new FileCache(),
      mockStatOps as any,
    );
  }

  describe("class", () => {
    it("should export GitHubDirectoryOperations class", () => {
      assertExists(GitHubDirectoryOperations);
      assertEquals(typeof GitHubDirectoryOperations, "function");
    });

    it("should be instantiable", () => {
      assertExists(createOps());
    });
  });

  describe("methods", () => {
    it("should have readdir method", () => {
      const ops = createOps();
      assertExists(ops.readdir);
      assertEquals(typeof ops.readdir, "function");
    });

    it("should have readDir method", () => {
      const ops = createOps();
      assertExists(ops.readDir);
      assertEquals(typeof ops.readDir, "function");
    });

    it("should return empty array for non-existent directory", () => {
      assertEquals(createOps().readdir("/non-existent"), []);
    });

    it("isolates directory cache entries by repository", () => {
      const cache = new FileCache();
      const first = new GitHubDirectoryOperations(
        mockConfig,
        cache,
        {
          isDirectory: () => true,
          getFilesInDirectory: () => [
            { path: "src/first.ts", sha: "first", size: 1, type: "blob" },
          ],
          getSubdirectories: () => [],
        } as any,
      );
      const second = new GitHubDirectoryOperations(
        { ...mockConfig, repo: "other-repo" },
        cache,
        {
          isDirectory: () => true,
          getFilesInDirectory: () => [
            { path: "src/second.ts", sha: "second", size: 1, type: "blob" },
          ],
          getSubdirectories: () => [],
        } as any,
      );

      assertEquals(first.readdir("src")[0]?.name, "first.ts");
      assertEquals(second.readdir("src")[0]?.name, "second.ts");
    });
  });
});
