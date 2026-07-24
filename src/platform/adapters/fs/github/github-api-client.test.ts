import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubApiClient } from "./github-api-client.ts";

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

function createClient(): GitHubApiClient {
  return new GitHubApiClient(mockConfig);
}

function assertMethod(client: GitHubApiClient, name: keyof GitHubApiClient): void {
  const value = client[name];
  assertExists(value);
  assertEquals(typeof value, "function");
}

describe("GitHubApiClient", () => {
  describe("class", () => {
    it("should export GitHubApiClient class", () => {
      assertExists(GitHubApiClient);
      assertEquals(typeof GitHubApiClient, "function");
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

    it("should retry when GitHub jitter produces a fractional delay", async () => {
      const originalFetch = globalThis.fetch;
      const originalRandom = Math.random;
      let requests = 0;
      globalThis.fetch = () => {
        requests++;
        if (requests === 1) {
          return Promise.resolve(new Response("temporary failure", { status: 500 }));
        }
        return Promise.resolve(Response.json({
          sha: "tree-sha",
          url: "https://api.github.com/repos/test-owner/test-repo/git/trees/tree-sha",
          tree: [],
          truncated: false,
        }));
      };
      Math.random = () => 0.0005;

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
        });

        const tree = await client.getTree();

        assertEquals(tree.sha, "tree-sha");
        assertEquals(requests, 2);
      } finally {
        globalThis.fetch = originalFetch;
        Math.random = originalRandom;
      }
    });

    it("should make one request without retrying when maxRetries is zero", async () => {
      const originalFetch = globalThis.fetch;
      let requests = 0;
      globalThis.fetch = () => {
        requests++;
        return Promise.resolve(new Response("temporary failure", { status: 500 }));
      };

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        });

        await assertRejects(
          () => client.getTree(),
          Error,
          "GitHub API error (500): temporary failure",
        );
        assertEquals(requests, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
