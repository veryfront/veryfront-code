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
          rateLimited: true,
          rateLimitResetAt: Date.now() + 60_000,
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

    it("encodes repository, ref, path, and blob identifiers without changing path hierarchy", async () => {
      const originalFetch = globalThis.fetch;
      const requests: Array<{ url: string; hasSignal: boolean }> = [];
      globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
        const value = String(url);
        requests.push({
          url: value,
          hasSignal: init?.signal instanceof AbortSignal,
        });

        if (value.includes("/git/trees/")) {
          return Promise.resolve(Response.json({
            sha: "tree-sha",
            tree: [],
            truncated: false,
          }));
        }
        if (value.includes("/contents/")) {
          return Promise.resolve(Response.json({
            type: "file",
            name: "file name#.ts",
            path: "dir/file name#.ts",
            sha: "blob-sha",
            size: 1,
            content: "eA==",
            encoding: "base64",
          }));
        }
        return Promise.resolve(Response.json({
          sha: "blob/sha",
          size: 1,
          content: "eA==",
          encoding: "base64",
        }));
      }) as typeof fetch;

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          owner: "owner/name",
          repo: "repo?name",
          ref: "feature/foo?preview=1",
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        });

        await client.getTree();
        await client.getContents("dir/file name#.ts");
        await client.getBlob("blob/sha");

        assertEquals(requests, [
          {
            url:
              "https://api.github.com/repos/owner%2Fname/repo%3Fname/git/trees/feature%2Ffoo%3Fpreview%3D1?recursive=1",
            hasSignal: true,
          },
          {
            url:
              "https://api.github.com/repos/owner%2Fname/repo%3Fname/contents/dir/file%20name%23.ts?ref=feature%2Ffoo%3Fpreview%3D1",
            hasSignal: true,
          },
          {
            url: "https://api.github.com/repos/owner%2Fname/repo%3Fname/git/blobs/blob%2Fsha",
            hasSignal: true,
          },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("fails closed when GitHub marks a recursive tree as truncated", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = () =>
        Promise.resolve(Response.json({
          sha: "tree-sha",
          tree: [{ path: "partial.ts", type: "blob", sha: "partial" }],
          truncated: true,
        }));

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        });
        await assertRejects(
          () => client.getTree(),
          Error,
          "truncated",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("ignores malformed rate-limit headers instead of constructing invalid dates", () => {
      const client = createClient();
      getInternals(client).updateRateLimitInfo(
        new Response(null, {
          headers: {
            "X-RateLimit-Limit": "5000",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": "not-a-timestamp",
          },
        }),
      );
      assertEquals(client.getRateLimitInfo(), null);
    });

    it("bounds and cancels error response bodies", async () => {
      const originalFetch = globalThis.fetch;
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(16 * 1024)));
        },
        cancel() {
          cancelled = true;
        },
      });
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(body, {
            status: 500,
            statusText: "Upstream failure",
          }),
        );

      try {
        const client = new GitHubApiClient({
          ...mockConfig,
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        });
        const error = await assertRejects(() => client.getTree());
        assertEquals(
          error instanceof Error && error.message.length < 9 * 1024,
          true,
        );
        assertEquals(cancelled, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
