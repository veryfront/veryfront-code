import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { GitHubStatOperations } from "./stat-operations.ts";
import { FileCache } from "../cache/file-cache.ts";

describe("GitHubStatOperations", () => {
  const mockConfig = {
    owner: "test-owner",
    repo: "test-repo",
    ref: "main",
    token: "test-token",
    basePath: "",
    retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000 },
    cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
  };

  const mockClient = {
    getTree: () => Promise.resolve({ tree: [], truncated: false }),
    repoId: "test-owner/test-repo",
  } as any;

  describe("class", () => {
    it("should export GitHubStatOperations class", () => {
      assertExists(GitHubStatOperations);
      assertEquals(typeof GitHubStatOperations, "function");
    });

    it("should be instantiable", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops);
    });
  });

  describe("methods", () => {
    it("should have buildIndex method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.buildIndex);
      assertEquals(typeof ops.buildIndex, "function");
    });

    it("should have stat method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.stat);
      assertEquals(typeof ops.stat, "function");
    });

    it("should have exists method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.exists);
      assertEquals(typeof ops.exists, "function");
    });

    it("should have resolveFile method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.resolveFile);
      assertEquals(typeof ops.resolveFile, "function");
    });

    it("should have getFileEntry method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.getFileEntry);
      assertEquals(typeof ops.getFileEntry, "function");
    });

    it("should have getFilesInDirectory method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.getFilesInDirectory);
      assertEquals(typeof ops.getFilesInDirectory, "function");
    });

    it("should have getSubdirectories method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.getSubdirectories);
      assertEquals(typeof ops.getSubdirectories, "function");
    });

    it("should have isDirectory method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.isDirectory);
      assertEquals(typeof ops.isDirectory, "function");
    });

    it("should have clearIndex method", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertExists(ops.clearIndex);
      assertEquals(typeof ops.clearIndex, "function");
    });
  });

  describe("initial state", () => {
    it("should return undefined for getFileEntry before index is built", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertEquals(ops.getFileEntry("test.ts"), undefined);
    });

    it("should return false for isDirectory before index is built", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertEquals(ops.isDirectory("test"), false);
    });

    it("should return empty array for getFilesInDirectory before index is built", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertEquals(ops.getFilesInDirectory("test"), []);
    });

    it("should return empty array for getSubdirectories before index is built", () => {
      const cache = new FileCache();
      const ops = new GitHubStatOperations(mockConfig, mockClient, cache);
      assertEquals(ops.getSubdirectories("test"), []);
    });
  });
});
