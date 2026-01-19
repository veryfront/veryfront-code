import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
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

  // Mock stat operations
  const mockStatOps = {
    isDirectory: (_path: string) => false,
    getFilesInDirectory: (_path: string) => [],
    getSubdirectories: (_path: string) => [],
  } as any;

  describe("class", () => {
    it("should export GitHubDirectoryOperations class", () => {
      assertExists(GitHubDirectoryOperations);
      assertEquals(typeof GitHubDirectoryOperations, "function");
    });

    it("should be instantiable", () => {
      const cache = new FileCache();
      const ops = new GitHubDirectoryOperations(mockConfig, cache, mockStatOps);
      assertExists(ops);
    });
  });

  describe("methods", () => {
    it("should have readdir method", () => {
      const cache = new FileCache();
      const ops = new GitHubDirectoryOperations(mockConfig, cache, mockStatOps);
      assertExists(ops.readdir);
      assertEquals(typeof ops.readdir, "function");
    });

    it("should have readDir method", () => {
      const cache = new FileCache();
      const ops = new GitHubDirectoryOperations(mockConfig, cache, mockStatOps);
      assertExists(ops.readDir);
      assertEquals(typeof ops.readDir, "function");
    });

    it("should return empty array for non-existent directory", () => {
      const cache = new FileCache();
      const ops = new GitHubDirectoryOperations(mockConfig, cache, mockStatOps);
      const entries = ops.readdir("/non-existent");
      assertEquals(entries, []);
    });
  });
});
