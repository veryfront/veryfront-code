import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubAPIClient } from "./github-api-client.ts";

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

function createClient(): GitHubAPIClient {
  return new GitHubAPIClient(mockConfig);
}

function assertMethod(client: GitHubAPIClient, name: keyof GitHubAPIClient): void {
  const value = client[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("GitHubAPIClient", () => {
  describe("class", () => {
    it("should export GitHubAPIClient class", () => {
      assertExists(GitHubAPIClient);
      assertEquals(typeof GitHubAPIClient, "function");
    });

    it("should be instantiable with config", () => {
      assertExists(createClient());
    });
  });

  describe("repoId", () => {
    it("should return owner/repo format", () => {
      assertEquals(createClient().repoId, "test-owner/test-repo");
    });
  });

  describe("methods", () => {
    it("should have getTree method", () => {
      assertMethod(createClient(), "getTree");
    });

    it("should have getContents method", () => {
      assertMethod(createClient(), "getContents");
    });

    it("should have getBlob method", () => {
      assertMethod(createClient(), "getBlob");
    });

    it("should have getRateLimitInfo method", () => {
      assertMethod(createClient(), "getRateLimitInfo");
    });

    it("should return null for initial rate limit info", () => {
      assertEquals(createClient().getRateLimitInfo(), null);
    });
  });
});
