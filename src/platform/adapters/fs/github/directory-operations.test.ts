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
    const cache = new FileCache();
    return new GitHubDirectoryOperations(mockConfig, cache, mockStatOps as any);
  }

  describe("class", () => {
    it("should export GitHubDirectoryOperations class", () => {
      assertExists(GitHubDirectoryOperations);
      assertEquals(typeof GitHubDirectoryOperations, "function");
    });

    it("should be instantiable", () => {
      const ops = createOps();
      assertExists(ops);
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
      const ops = createOps();
      const entries = ops.readdir("/non-existent");
      assertEquals(entries, []);
    });
  });
});
