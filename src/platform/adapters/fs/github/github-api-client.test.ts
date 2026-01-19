import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { GitHubAPIClient } from "./github-api-client.ts";

describe("GitHubAPIClient", () => {
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

  describe("class", () => {
    it("should export GitHubAPIClient class", () => {
      assertExists(GitHubAPIClient);
      assertEquals(typeof GitHubAPIClient, "function");
    });

    it("should be instantiable with config", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertExists(client);
    });
  });

  describe("repoId", () => {
    it("should return owner/repo format", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertEquals(client.repoId, "test-owner/test-repo");
    });
  });

  describe("methods", () => {
    it("should have getTree method", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertExists(client.getTree);
      assertEquals(typeof client.getTree, "function");
    });

    it("should have getContents method", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertExists(client.getContents);
      assertEquals(typeof client.getContents, "function");
    });

    it("should have getBlob method", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertExists(client.getBlob);
      assertEquals(typeof client.getBlob, "function");
    });

    it("should have getRateLimitInfo method", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertExists(client.getRateLimitInfo);
      assertEquals(typeof client.getRateLimitInfo, "function");
    });

    it("should return null for initial rate limit info", () => {
      const client = new GitHubAPIClient(mockConfig);
      assertEquals(client.getRateLimitInfo(), null);
    });
  });
});
