import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
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

// Same retry budget as mockConfig, but with backoff delays small enough that an
// exhausted retry sequence stays inside a unit test's time budget.
function createFastRetryClient(): GitHubApiClient {
  return new GitHubApiClient({
    ...mockConfig,
    retry: { maxRetries: mockConfig.retry.maxRetries, initialDelay: 1, maxDelay: 1 },
  });
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

    it("rejects repository identity that could escape its URL segments", () => {
      for (
        const [field, value] of [
          ["owner", ".."],
          ["owner", "%2e%2e"],
          ["owner", "%25252e%25252e"],
          ["owner", "team/other"],
          ["owner", "team%2Fother"],
          ["repo", "."],
          ["repo", "..\\other"],
          ["repo", "repo%5Cother"],
          ["repo", "repo\u0000name"],
          ["repo", "r".repeat(257)],
        ] as const
      ) {
        // Repository identity failures retain stable CONFIG error semantics.
        const error = assertThrows(
          () => new GitHubApiClient({ ...mockConfig, [field]: value }),
          VeryfrontError,
          "GitHub",
        );
        assertInstanceOf(error, VeryfrontError);
        assertEquals(error.slug, "config-validation-failed");
      }
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

    it("should have bounded raw blob method", () => {
      assertMethod(createClient(), "getBlobBytesWithinLimit");
    });

    it("should have getRateLimitInfo method", () => {
      assertMethod(createClient(), "getRateLimitInfo");
    });

    it("should return null for initial rate limit info", () => {
      assertEquals(createClient().getRateLimitInfo(), null);
    });
  });

  describe("getBlobBytesWithinLimit", () => {
    it("rejects an expected size above the byte limit before fetching", async () => {
      let fetchCalls = 0;
      await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(new Response(new Uint8Array()));
        },
        async () => {
          await assertRejects(
            () => createClient().getBlobBytesWithinLimit("sha-1", 5, 4),
            RangeError,
            "GitHub blob exceeds 4 bytes",
          );
        },
      );

      assertEquals(fetchCalls, 0, "expectedSize above byteLimit must reject before any fetch");
    });

    it("rejects a truncated blob body instead of zero-padding it", async () => {
      await withMockFetch(
        () => Promise.resolve(new Response(new Uint8Array([1, 2]))),
        async () => {
          await assertRejects(
            () => createClient().getBlobBytesWithinLimit("sha-1", 4, 4),
            Error,
            "does not match its admitted 4-byte tree entry",
          );
        },
      );
    });

    it("rejects a blob body longer than its admitted tree entry", async () => {
      await withMockFetch(
        () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4, 5]))),
        async () => {
          await assertRejects(
            () => createClient().getBlobBytesWithinLimit("sha-1", 4, 8),
            Error,
            "does not match its admitted 4-byte tree entry",
          );
        },
      );
    });

    it("rejects a declared Content-Length above the limit before streaming the body", async () => {
      let bodyCancelled = false;
      await withMockFetch(
        () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
                },
                cancel() {
                  bodyCancelled = true;
                },
              }),
              { headers: { "Content-Length": "5" } },
            ),
          ),
        async () => {
          // The pre-stream guard and the over-long-chunk guard report different
          // messages, so the message pins which branch rejected this response.
          await assertRejects(
            () => createClient().getBlobBytesWithinLimit("sha-1", 4, 4),
            Error,
            "exceeds 4 bytes before streaming",
          );
        },
      );

      assertEquals(
        bodyCancelled,
        true,
        "a Content-Length above the limit must cancel the body instead of streaming it",
      );
    });

    it("returns the exact admitted bytes", async () => {
      const result = await withMockFetch(
        () => Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4]))),
        () => createClient().getBlobBytesWithinLimit("sha-1", 4, 4),
      );

      assertEquals(
        [...result],
        [1, 2, 3, 4],
        "bounded blob read returns the exact admitted bytes",
      );
    });
  });

  describe("HTTP failure policy", () => {
    it("attempts a 404 exactly once and classifies it as a file error", async () => {
      let fetchCalls = 0;
      const error = await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(new Response("Not found", { status: 404 }));
        },
        () => assertRejects(() => createFastRetryClient().getTree("main"), Error),
      );

      assertInstanceOf(error, Error);
      assertEquals(fetchCalls, 1, "a 404 must not be retried");
      assertEquals(
        (error as { statusCode?: number }).statusCode,
        404,
        "the API error carries its status code",
      );
      assertEquals(
        error.name,
        "VeryfrontError[file]",
        "a missing file must not be classified as a transient network fault",
      );
    });

    it("attempts a 401 exactly once and classifies it as a config error", async () => {
      let fetchCalls = 0;
      const error = await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(new Response("Bad credentials", { status: 401 }));
        },
        () => assertRejects(() => createFastRetryClient().getTree("main"), Error),
      );

      assertInstanceOf(error, Error);
      assertEquals(fetchCalls, 1, "an auth failure must not be retried");
      assertEquals(
        error.name,
        "VeryfrontError[config]",
        "an auth failure must be classified as a configuration fault",
      );
    });

    it("retries a 403 once the rate limit is exhausted", async () => {
      let fetchCalls = 0;
      const resetSeconds = Math.floor(Date.now() / 1000);
      const error = await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(
            new Response("rate limited", {
              status: 403,
              headers: {
                "X-RateLimit-Limit": "60",
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Used": "60",
                "X-RateLimit-Reset": String(resetSeconds),
              },
            }),
          );
        },
        () => assertRejects(() => createFastRetryClient().getTree("main"), Error),
      );

      assertInstanceOf(error, Error);
      assertEquals(
        fetchCalls,
        mockConfig.retry.maxRetries,
        "an exhausted rate limit must consume the whole retry budget",
      );
      assertEquals(
        error.message,
        `GitHub API rate limit exceeded. Resets at ${new Date(resetSeconds * 1000).toISOString()}`,
        "the rate limit error names the reset instant",
      );
    });

    it("retries a 500 up to the retry budget", async () => {
      let fetchCalls = 0;
      await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(new Response("boom", { status: 500 }));
        },
        () => assertRejects(() => createFastRetryClient().getTree("main"), Error),
      );

      assertEquals(
        fetchCalls,
        mockConfig.retry.maxRetries,
        "server errors exhaust the retry budget",
      );
    });

    it("records rate limit headers from a successful response", async () => {
      const resetSeconds = 1_700_000_000;
      const client = createClient();

      await withMockFetch(
        () =>
          Promise.resolve(
            Response.json({ sha: "tree", tree: [], truncated: false }, {
              headers: {
                "X-RateLimit-Limit": "60",
                "X-RateLimit-Remaining": "42",
                "X-RateLimit-Used": "18",
                "X-RateLimit-Reset": String(resetSeconds),
              },
            }),
          ),
        () => client.getTree("main"),
      );

      assertEquals(
        client.getRateLimitInfo(),
        {
          limit: 60,
          remaining: 42,
          reset: new Date(resetSeconds * 1000),
          used: 18,
        },
        "a successful response records its rate limit headers",
      );
    });
  });

  describe("getContents", () => {
    it("encodes path segments and refs before URL construction", async () => {
      const requestedUrls: string[] = [];
      await withMockFetch(
        (input) => {
          requestedUrls.push(String(input));
          return Promise.resolve(Response.json({
            type: "file",
            name: "file.ts",
            path: "file.ts",
            sha: "sha-1",
            size: 0,
            content: "",
            encoding: "base64",
          }));
        },
        async () => {
          const client = createClient();
          for (
            const path of [
              "%2e%2e/%2E%2E/user/repos",
              "..\\..\\user/repos",
              "docs/read me#draft?.md",
            ]
          ) {
            await client.getContents(path, "feature/secure-paths");
          }
        },
      );

      assertEquals(requestedUrls.length, 3);
      for (const requestedUrl of requestedUrls) {
        const url = new URL(requestedUrl);
        assertEquals(
          url.pathname.startsWith("/repos/test-owner/test-repo/contents/"),
          true,
        );
        assertEquals(url.searchParams.get("ref"), "feature/secure-paths");
      }
      assertEquals(
        new URL(requestedUrls[0]!).pathname,
        "/repos/test-owner/test-repo/contents/%252e%252e/%252E%252E/user/repos",
      );
      assertEquals(
        new URL(requestedUrls[1]!).pathname,
        "/repos/test-owner/test-repo/contents/..%5C..%5Cuser/repos",
      );
      assertEquals(
        new URL(requestedUrls[2]!).pathname,
        "/repos/test-owner/test-repo/contents/docs/read%20me%23draft%3F.md",
      );
    });

    it("rejects literal traversal segments before fetching", async () => {
      let fetchCalls = 0;
      await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(Response.json({}));
        },
        async () => {
          await assertRejects(
            () => createClient().getContents("../secrets"),
            TypeError,
            "traversal",
          );
        },
      );
      assertEquals(fetchCalls, 0);
    });
  });

  describe("endpoint construction", () => {
    it("rejects dot-only endpoint values before fetching", async () => {
      let fetchCalls = 0;
      await withMockFetch(
        () => {
          fetchCalls++;
          return Promise.resolve(Response.json({}));
        },
        async () => {
          await assertRejects(() => createClient().getTree(".."), TypeError);
          await assertRejects(() => createClient().getBlob("."), TypeError);
        },
      );
      assertEquals(fetchCalls, 0);
    });

    it("encodes repository identity, refs, and blob identifiers as path segments", async () => {
      const requestedUrls: string[] = [];
      const client = new GitHubApiClient({
        ...mockConfig,
        owner: "test owner",
        repo: "repo#name",
      });

      await withMockFetch(
        (input) => {
          const url = String(input);
          requestedUrls.push(url);
          return Promise.resolve(
            url.includes("/git/trees/")
              ? Response.json({ sha: "tree", tree: [], truncated: false })
              : Response.json({ sha: "blob", size: 0, content: "", encoding: "base64" }),
          );
        },
        async () => {
          await client.getTree("feature/secure?recursive=0");
          await client.getBlob("sha/../other");
        },
      );

      assertEquals(
        new URL(requestedUrls[0]!).pathname,
        "/repos/test%20owner/repo%23name/git/trees/feature%2Fsecure%3Frecursive%3D0",
      );
      assertEquals(
        new URL(requestedUrls[1]!).pathname,
        "/repos/test%20owner/repo%23name/git/blobs/sha%2F..%2Fother",
      );
    });
  });
});
