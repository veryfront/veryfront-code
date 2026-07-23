import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
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
    requestTimeout: 30_000,
    totalTimeout: 120_000,
    maxResponseBytes: 64 * 1024 * 1024,
  },
  cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
};

function createClient(
  dependencies?: ConstructorParameters<typeof GitHubApiClient>[1],
  retry: Partial<typeof mockConfig.retry> = {},
): GitHubApiClient {
  return new GitHubApiClient(
    { ...mockConfig, retry: { ...mockConfig.retry, ...retry } },
    dependencies,
  );
}

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), { status: 200, ...init });
}

const emptyTree = { sha: "root", tree: [], truncated: false };

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

    it("rejects unreadable dependencies without retaining trap data", () => {
      const secret = "PRIVATE_GITHUB_DEPENDENCY/project-741";
      const dependencies = Object.create(null);
      Object.defineProperty(dependencies, "fetch", {
        get() {
          throw new Error(secret);
        },
      });

      let error: unknown;
      try {
        new GitHubApiClient(mockConfig, dependencies);
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof VeryfrontError, true);
      assertEquals(JSON.stringify(error).includes(secret), false);
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

  describe("requests", () => {
    it("encodes repository identifiers, tree refs, content paths, and query refs", async () => {
      const urls: URL[] = [];
      const client = new GitHubApiClient(
        {
          ...mockConfig,
          owner: "owner name",
          repo: "repo#name",
          ref: "feature/a&b",
        },
        {
          fetch: (input) => {
            urls.push(new URL(String(input)));
            return Promise.resolve(jsonResponse(emptyTree));
          },
        },
      );

      await client.getTree("feature/tree#one");

      const contentClient = new GitHubApiClient(
        { ...mockConfig, ref: "feature/a&b" },
        {
          fetch: (input) => {
            urls.push(new URL(String(input)));
            return Promise.resolve(jsonResponse({
              type: "file",
              name: "file.ts",
              path: "src/a b/file.ts",
              sha: "sha",
              size: 0,
              content: "",
              encoding: "base64",
            }));
          },
        },
      );
      await contentClient.getContents("src/a b/file#.ts");

      const [treeUrl, contentsUrl] = urls;
      assertExists(treeUrl);
      assertExists(contentsUrl);
      assertEquals(
        treeUrl.pathname,
        "/repos/owner%20name/repo%23name/git/trees/feature%2Ftree%23one",
      );
      assertEquals(treeUrl.searchParams.get("recursive"), "1");
      assertEquals(
        contentsUrl.pathname,
        "/repos/test-owner/test-repo/contents/src/a%20b/file%23.ts",
      );
      assertEquals(contentsUrl.searchParams.get("ref"), "feature/a&b");
    });

    it("makes one initial request when maxRetries is zero", async () => {
      let attempts = 0;
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.reject(new Error("offline"));
        },
        sleep: () => Promise.resolve(),
      }, { maxRetries: 0 });

      await assertRejects(() => client.getTree(), Error, "GitHub API request failed");
      assertEquals(attempts, 1);
    });

    it("rejects an invalid random source without retrying or sleeping", async () => {
      let attempts = 0;
      const delays: number[] = [];
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.resolve(new Response(null, { status: 500 }));
        },
        random: () => Number.NaN,
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      }, { maxRetries: 1 });

      await assertRejects(
        () => client.getTree(),
        Error,
        "random source returned an invalid value",
      );
      assertEquals(attempts, 1);
      assertEquals(delays, []);
    });

    it("uses Retry-After as the minimum server-requested delay", async () => {
      let attempts = 0;
      const delays: number[] = [];
      const client = createClient({
        fetch: () => {
          attempts++;
          if (attempts === 1) {
            return Promise.resolve(
              new Response("limited", {
                status: 429,
                headers: { "Retry-After": "60" },
              }),
            );
          }
          return Promise.resolve(jsonResponse(emptyTree));
        },
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
        random: () => 0,
      }, { maxRetries: 1, initialDelay: 5, maxDelay: 25 });

      await client.getTree();
      assertEquals(attempts, 2);
      assertEquals(delays, [60_000]);
    });

    it("does not shorten Retry-After when it exceeds the remaining lifecycle budget", async () => {
      let attempts = 0;
      const delays: number[] = [];
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.resolve(
            new Response("limited", {
              status: 429,
              headers: { "Retry-After": "60" },
            }),
          );
        },
        sleep: (delay) => {
          delays.push(delay);
          return Promise.resolve();
        },
      }, {
        maxRetries: 1,
        initialDelay: 5,
        maxDelay: 25,
        totalTimeout: 50,
      });

      await assertRejects(() => client.getTree(), Error, "rate limit exceeded");
      assertEquals(attempts, 1);
      assertEquals(delays, []);
    });

    it("does not expose upstream response bodies in errors", async () => {
      const client = createClient({
        fetch: () => Promise.resolve(new Response("private upstream detail", { status: 422 })),
      }, { maxRetries: 0 });

      const error = await assertRejects(() => client.getTree());
      assert(error instanceof Error);
      assertEquals(error.message.includes("private upstream detail"), false);
    });

    it("ignores malformed rate-limit headers", async () => {
      const client = createClient({
        fetch: () =>
          Promise.resolve(jsonResponse(emptyTree, {
            headers: {
              "X-RateLimit-Limit": "invalid",
              "X-RateLimit-Remaining": "invalid",
              "X-RateLimit-Reset": "invalid",
            },
          })),
      });

      await client.getTree();
      assertEquals(client.getRateLimitInfo(), null);
    });

    it("aborts requests that exceed requestTimeout", async () => {
      let observedAbort = false;
      const client = createClient({
        fetch: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              observedAbort = true;
              reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
            });
          }),
      }, { maxRetries: 0, requestTimeout: 1 });

      await assertRejects(() => client.getTree(), Error, "GitHub API request timed out");
      assertEquals(observedAbort, true);
    });

    it("keeps the timeout active while reading the response body", async () => {
      let observedAbort = false;
      const client = createClient({
        fetch: (_input, init) => {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const completion = setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(emptyTree)));
                controller.close();
              }, 20);
              init?.signal?.addEventListener("abort", () => {
                observedAbort = true;
                clearTimeout(completion);
                controller.error(init.signal?.reason);
              });
            },
          });
          return Promise.resolve(new Response(stream, { status: 200 }));
        },
      }, { maxRetries: 0, requestTimeout: 1 });

      await assertRejects(() => client.getTree(), Error, "GitHub API request timed out");
      assertEquals(observedAbort, true);
    });

    it("cancels a successful response body that exceeds the configured limit", async () => {
      let bodyCancelled = false;
      const oversized = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"sha":"private-response-'));
          controller.enqueue(new TextEncoder().encode('secret","tree":[],"truncated":false}'));
        },
        cancel() {
          bodyCancelled = true;
        },
      });
      const client = createClient({
        fetch: () => Promise.resolve(new Response(oversized, { status: 200 })),
      }, { maxRetries: 0, maxResponseBytes: 16 });

      const error = await assertRejects(
        () => client.getTree(),
        Error,
        "response exceeded the configured size limit",
      );

      assertEquals(bodyCancelled, true);
      assertEquals(JSON.stringify(error).includes("private-response-secret"), false);
    });

    it("accepts a response body exactly at the configured limit", async () => {
      const body = JSON.stringify(emptyTree);
      const client = createClient({
        fetch: () => Promise.resolve(new Response(body, { status: 200 })),
      }, { maxRetries: 0, maxResponseBytes: new TextEncoder().encode(body).byteLength });

      assertEquals(await client.getTree(), emptyTree);
    });

    it("cancels an in-flight request without retaining the abort reason", async () => {
      const secret = "PRIVATE_ABORT_REASON/project-789";
      const controller = new AbortController();
      let attempts = 0;
      let transportAborted = false;
      const client = createClient({
        fetch: (_input, init) => {
          attempts++;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              transportAborted = true;
              reject(new Error(secret));
            });
          });
        },
      });

      const pending = client.getTree(undefined, { signal: controller.signal });
      controller.abort(new Error(secret));
      const error = await assertRejects(
        () => pending,
        Error,
        "GitHub API request was cancelled",
      );

      assertEquals(attempts, 1);
      assertEquals(transportAborted, true);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("rejects an already-cancelled operation before starting the transport", async () => {
      const secret = "PRIVATE_PRE_ABORT/project-852";
      const controller = new AbortController();
      controller.abort(new Error(secret));
      let attempts = 0;
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.resolve(jsonResponse(emptyTree));
        },
      });

      const error = await assertRejects(
        () => client.getTree(undefined, { signal: controller.signal }),
        Error,
        "GitHub API request was cancelled",
      );

      assertEquals(attempts, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("rejects a revoked AbortSignal proxy before starting the transport", async () => {
      let attempts = 0;
      const { proxy: signal, revoke } = Proxy.revocable(new AbortController().signal, {});
      revoke();
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.resolve(jsonResponse(emptyTree));
        },
      });

      await assertRejects(
        () => client.getTree(undefined, { signal }),
        Error,
        "GitHub request signal is invalid",
      );
      assertEquals(attempts, 0);
    });

    it("does not accept a response completed after the operation deadline", async () => {
      let clock = 0;
      const client = createClient({
        monotonicNow: () => clock,
        fetch: () => {
          clock = 6;
          return Promise.resolve(jsonResponse(emptyTree));
        },
      }, { maxRetries: 0, totalTimeout: 5 });

      await assertRejects(() => client.getTree(), Error, "GitHub API request timed out");
    });

    it("rejects unreadable request options before starting the transport", async () => {
      const secret = "PRIVATE_REQUEST_OPTION/project-987";
      let attempts = 0;
      const client = createClient({
        fetch: () => {
          attempts++;
          return Promise.resolve(jsonResponse(emptyTree));
        },
      });
      const options = Object.create(null);
      Object.defineProperty(options, "signal", {
        get() {
          throw new Error(secret);
        },
      });

      const error = await assertRejects(
        () => client.getTree(undefined, options),
        Error,
        "GitHub request options are not readable",
      );

      assertEquals(attempts, 0);
      assertEquals(JSON.stringify(error).includes(secret), false);
    });

    it("does not reuse stale rate-limit state for a later forbidden response", async () => {
      let attempts = 0;
      const client = createClient({
        fetch: () => {
          attempts++;
          if (attempts === 1) {
            return Promise.resolve(jsonResponse(emptyTree, {
              headers: {
                "X-RateLimit-Limit": "5000",
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": "4102444800",
              },
            }));
          }
          return Promise.resolve(new Response("forbidden", { status: 403 }));
        },
        sleep: () => Promise.resolve(),
      }, { maxRetries: 1, initialDelay: 0, maxDelay: 0 });

      await client.getTree();
      await assertRejects(() => client.getTree(), Error, "forbidden");
      assertEquals(attempts, 2);
    });

    it("returns a defensive copy of rate-limit state", async () => {
      const client = createClient({
        fetch: () =>
          Promise.resolve(jsonResponse(emptyTree, {
            headers: {
              "X-RateLimit-Limit": "5000",
              "X-RateLimit-Remaining": "4999",
              "X-RateLimit-Reset": "4102444800",
            },
          })),
      });

      await client.getTree();
      const first = client.getRateLimitInfo();
      assertExists(first);
      first.remaining = 0;
      first.reset.setTime(0);

      const second = client.getRateLimitInfo();
      assertExists(second);
      assertEquals(second.remaining, 4999);
      assertEquals(second.reset.getTime(), 4_102_444_800_000);
    });
  });

  describe("truncated trees", () => {
    it("walks subtrees to produce a complete index", async () => {
      const client = createClient({
        fetch: (input) => {
          const url = new URL(String(input));
          const tree = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          if (url.searchParams.get("recursive") === "1") {
            return Promise.resolve(jsonResponse({ sha: "root", tree: [], truncated: true }));
          }
          if (tree === "main") {
            return Promise.resolve(jsonResponse({
              sha: "root",
              truncated: false,
              tree: [
                { path: "README.md", type: "blob", sha: "readme", size: 1 },
                { path: "src", type: "tree", sha: "src-tree" },
              ],
            }));
          }
          if (tree === "src-tree") {
            return Promise.resolve(jsonResponse({
              sha: "src-tree",
              truncated: false,
              tree: [
                { path: "index.ts", type: "blob", sha: "index", size: 2 },
                { path: "nested", type: "tree", sha: "nested-tree" },
              ],
            }));
          }
          return Promise.resolve(jsonResponse({
            sha: "nested-tree",
            truncated: false,
            tree: [{ path: "file.ts", type: "blob", sha: "file", size: 3 }],
          }));
        },
      });

      const result = await client.getTree();
      assertEquals(result.truncated, false);
      assertEquals(result.tree.map((entry) => entry.path), [
        "README.md",
        "src",
        "src/index.ts",
        "src/nested",
        "src/nested/file.ts",
      ]);
    });

    it("rejects a truncated non-recursive subtree", async () => {
      const client = createClient({
        fetch: () => Promise.resolve(jsonResponse({ sha: "root", tree: [], truncated: true })),
      });

      await assertRejects(() => client.getTree(), Error, "complete repository tree");
    });

    it("cancels sibling subtree requests after traversal fails", async () => {
      let observedAborts = 0;
      const client = createClient({
        fetch: (input, init) => {
          const url = new URL(String(input));
          const tree = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          if (url.searchParams.get("recursive") === "1") {
            return Promise.resolve(jsonResponse({ sha: "root", tree: [], truncated: true }));
          }
          if (tree === "main") {
            return Promise.resolve(jsonResponse({
              sha: "root",
              truncated: false,
              tree: Array.from({ length: 9 }, (_, index) => ({
                path: `dir-${index}`,
                type: "tree",
                sha: `tree-${index}`,
              })),
            }));
          }
          if (tree === "tree-0") {
            return Promise.resolve(new Response(null, { status: 500 }));
          }

          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              observedAborts++;
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        },
      }, { maxRetries: 0 });

      await assertRejects(() => client.getTree(), Error, "status 500");
      assert(observedAborts > 0);
    });

    it("reuses a subtree response while preserving each path prefix", async () => {
      let sharedTreeRequests = 0;
      const client = createClient({
        fetch: (input) => {
          const url = new URL(String(input));
          const tree = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
          if (url.searchParams.get("recursive") === "1") {
            return Promise.resolve(jsonResponse({ sha: "root", tree: [], truncated: true }));
          }
          if (tree === "main") {
            return Promise.resolve(jsonResponse({
              sha: "root",
              truncated: false,
              tree: [
                { path: "a", type: "tree", sha: "shared" },
                { path: "b", type: "tree", sha: "shared" },
              ],
            }));
          }

          sharedTreeRequests++;
          return Promise.resolve(jsonResponse({
            sha: "shared",
            truncated: false,
            tree: [{ path: "file.ts", type: "blob", sha: "file", size: 1 }],
          }));
        },
      });

      const result = await client.getTree();
      assertEquals(result.tree.map((entry) => entry.path), ["a", "a/file.ts", "b", "b/file.ts"]);
      assertEquals(sharedTreeRequests, 1);
    });

    it("rejects unsafe paths in a tree response", async () => {
      const client = createClient({
        fetch: () =>
          Promise.resolve(jsonResponse({
            sha: "root",
            truncated: false,
            tree: [{ path: "../private.ts", type: "blob", sha: "file", size: 1 }],
          })),
      });

      await assertRejects(() => client.getTree(), Error, "invalid tree response");
    });

    it("rejects blob entries without a size", async () => {
      const client = createClient({
        fetch: () =>
          Promise.resolve(jsonResponse({
            sha: "root",
            truncated: false,
            tree: [{ path: "file.ts", type: "blob", sha: "file" }],
          })),
      });

      await assertRejects(() => client.getTree(), Error, "invalid tree response");
    });
  });
});
