import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
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

interface GitHubApiClientInternals {
  calculateRetryDelay(attempt: number, error: Error): number;
  updateRateLimitInfo(response: Response): void;
}

function getInternals(client: GitHubApiClient): GitHubApiClientInternals {
  return client as unknown as GitHubApiClientInternals;
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

    it("validates retry policy at direct client construction", () => {
      for (
        const retry of [
          { maxRetries: -1, initialDelay: 0, maxDelay: 0 },
          { maxRetries: 2.5, initialDelay: 0, maxDelay: 0 },
          { maxRetries: 11, initialDelay: 0, maxDelay: 0 },
          { maxRetries: 2, initialDelay: -1, maxDelay: 0 },
          { maxRetries: 2, initialDelay: 0, maxDelay: Infinity },
          { maxRetries: 2, initialDelay: 2, maxDelay: 1 },
        ]
      ) {
        assertThrows(
          () => new GitHubApiClient({ ...mockConfig, retry }),
          RangeError,
        );
      }
    });

    it("caps jitter and rate-limit waits at the configured portable delay", () => {
      const originalRandom = Math.random;
      Math.random = () => 0.999_999;

      try {
        const jitterClient = new GitHubApiClient({
          ...mockConfig,
          retry: {
            maxRetries: 2,
            initialDelay: MAX_TIMER_DELAY_MS,
            maxDelay: MAX_TIMER_DELAY_MS,
          },
        });
        assertEquals(
          getInternals(jitterClient).calculateRetryDelay(2, new Error("retry")),
          MAX_TIMER_DELAY_MS,
        );

        const rateLimitClient = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 2, initialDelay: 10, maxDelay: 25 },
        });
        getInternals(rateLimitClient).updateRateLimitInfo(
          new Response(null, {
            headers: {
              "X-RateLimit-Limit": "100",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
            },
          }),
        );
        const rateLimitError = Object.assign(new Error("rate limited"), {
          statusCode: 403,
        });
        assertEquals(
          getInternals(rateLimitClient).calculateRetryDelay(2, rateLimitError),
          25,
        );
      } finally {
        Math.random = originalRandom;
      }
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
          retry: { maxRetries: 2, initialDelay: 0, maxDelay: 1 },
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

    it("preserves the historical total-attempt meaning of maxRetries", async () => {
      const originalFetch = globalThis.fetch;
      const originalRandom = Math.random;
      let requests = 0;
      globalThis.fetch = () => {
        requests++;
        return Promise.resolve(new Response("temporary failure", { status: 500 }));
      };
      Math.random = () => 0;

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 2, initialDelay: 0, maxDelay: 0 },
        });

        await assertRejects(
          () => client.getTree(),
          Error,
          "GitHub API error (500): temporary failure",
        );
        assertEquals(requests, 2);
      } finally {
        globalThis.fetch = originalFetch;
        Math.random = originalRandom;
      }
    });
  });
});
