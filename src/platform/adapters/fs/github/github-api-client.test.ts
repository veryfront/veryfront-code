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
