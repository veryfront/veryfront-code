import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubReadOperations } from "./read-operations.ts";

describe("GitHubReadOperations", () => {
  describe("class", () => {
    it("should export GitHubReadOperations class", () => {
      assertExists(GitHubReadOperations);
      assertEquals(typeof GitHubReadOperations, "function");
    });
  });

  describe("methods", () => {
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
      getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==" }),
      getBlob: () => Promise.resolve({ content: "dGVzdA==", encoding: "base64" }),
      repoId: "test-owner/test-repo",
    } as any;

    const mockCache = {
      get: () => undefined,
      set: () => {},
    } as any;

    const mockStatOps = {
      getFileEntry: () => undefined,
    } as any;

    it("should be instantiable", () => {
      const ops = new GitHubReadOperations(
        mockConfig,
        mockClient,
        mockCache,
        mockStatOps,
      );
      assertExists(ops);
    });

    it("should have readTextFile method", () => {
      const ops = new GitHubReadOperations(
        mockConfig,
        mockClient,
        mockCache,
        mockStatOps,
      );
      assertExists(ops.readTextFile);
      assertEquals(typeof ops.readTextFile, "function");
    });

    it("should have readFile method", () => {
      const ops = new GitHubReadOperations(
        mockConfig,
        mockClient,
        mockCache,
        mockStatOps,
      );
      assertExists(ops.readFile);
      assertEquals(typeof ops.readFile, "function");
    });
  });
});
