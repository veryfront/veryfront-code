import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FileCache } from "../cache/file-cache.ts";
import { GitHubStatOperations } from "./stat-operations.ts";

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

  function createOps(): GitHubStatOperations {
    return new GitHubStatOperations(mockConfig, mockClient, new FileCache());
  }

  function assertHasMethod<T extends object>(obj: T, key: keyof T): void {
    const value = obj[key];
    assertExists(value);
    assertEquals(typeof value, "function");
  }

  describe("class", () => {
    it("should export GitHubStatOperations class", () => {
      assertExists(GitHubStatOperations);
      assertEquals(typeof GitHubStatOperations, "function");
    });

    it("should be instantiable", () => {
      assertExists(createOps());
    });
  });

  describe("methods", () => {
    it("should have buildIndex method", () => {
      assertHasMethod(createOps(), "buildIndex");
    });

    it("should have stat method", () => {
      assertHasMethod(createOps(), "stat");
    });

    it("should have exists method", () => {
      assertHasMethod(createOps(), "exists");
    });

    it("should have resolveFile method", () => {
      assertHasMethod(createOps(), "resolveFile");
    });

    it("should have getFileEntry method", () => {
      assertHasMethod(createOps(), "getFileEntry");
    });

    it("should have getFilesInDirectory method", () => {
      assertHasMethod(createOps(), "getFilesInDirectory");
    });

    it("should have getSubdirectories method", () => {
      assertHasMethod(createOps(), "getSubdirectories");
    });

    it("should have isDirectory method", () => {
      assertHasMethod(createOps(), "isDirectory");
    });

    it("should have clearIndex method", () => {
      assertHasMethod(createOps(), "clearIndex");
    });
  });

  describe("initial state", () => {
    it("should return undefined for getFileEntry before index is built", () => {
      assertEquals(createOps().getFileEntry("test.ts"), undefined);
    });

    it("should return false for isDirectory before index is built", () => {
      assertEquals(createOps().isDirectory("test"), false);
    });

    it("should return empty array for getFilesInDirectory before index is built", () => {
      assertEquals(createOps().getFilesInDirectory("test"), []);
    });

    it("should return empty array for getSubdirectories before index is built", () => {
      assertEquals(createOps().getSubdirectories("test"), []);
    });
  });

  describe("failure and cache semantics", () => {
    it("does not turn repository/index failures into a false existence result", async () => {
      const failure = new Error("GitHub unavailable");
      const ops = new GitHubStatOperations(
        mockConfig,
        {
          getTree: () => Promise.reject(failure),
          repoId: "test-owner/test-repo",
        } as any,
        new FileCache(),
      );

      const error = await assertRejects(() => ops.exists("file.ts"));
      assertEquals(error, failure);
    });

    it("includes allowPagesPrefix in resolve cache identity", async () => {
      const ops = new GitHubStatOperations(
        mockConfig,
        {
          getTree: () =>
            Promise.resolve({
              tree: [
                {
                  path: "pages/about.mdx",
                  type: "blob",
                  sha: "about-sha",
                  size: 12,
                },
              ],
              truncated: false,
            }),
          repoId: "test-owner/test-repo",
        } as any,
        new FileCache(),
      );

      assertEquals(await ops.resolveFile("about"), "pages/about.mdx");
      assertEquals(
        await ops.resolveFile("about", { allowPagesPrefix: false }),
        null,
      );
    });

    it("isolates stat cache entries by repository", async () => {
      const cache = new FileCache();
      const first = new GitHubStatOperations(
        mockConfig,
        {
          getTree: () =>
            Promise.resolve({
              tree: [{ path: "shared.ts", type: "blob", sha: "first", size: 1 }],
              truncated: false,
            }),
          repoId: "test-owner/test-repo",
        } as any,
        cache,
      );
      const second = new GitHubStatOperations(
        { ...mockConfig, repo: "other-repo" },
        {
          getTree: () =>
            Promise.resolve({
              tree: [{ path: "shared.ts", type: "blob", sha: "second", size: 2 }],
              truncated: false,
            }),
          repoId: "test-owner/other-repo",
        } as any,
        cache,
      );

      assertEquals((await first.stat("shared.ts")).size, 1);
      assertEquals((await second.stat("shared.ts")).size, 2);
    });

    it("does not let an index build commit after clearIndex invalidates it", async () => {
      let resolveTree:
        | ((tree: {
          tree: Array<{ path: string; type: "blob"; sha: string; size: number }>;
          truncated: boolean;
        }) => void)
        | undefined;
      const treePromise = new Promise<{
        tree: Array<{ path: string; type: "blob"; sha: string; size: number }>;
        truncated: boolean;
      }>((resolve) => {
        resolveTree = resolve;
      });
      const ops = new GitHubStatOperations(
        mockConfig,
        {
          getTree: () => treePromise,
          repoId: "test-owner/test-repo",
        } as any,
        new FileCache(),
      );

      const pending = ops.buildIndex();
      await Promise.resolve();
      ops.clearIndex();
      resolveTree?.({
        tree: [{ path: "late.ts", type: "blob", sha: "late", size: 1 }],
        truncated: false,
      });

      await assertRejects(() => pending, Error, "invalidated");
      assertEquals(ops.getFileEntry("late.ts"), undefined);
    });

    it("rejects non-canonical paths from repository tree responses", async () => {
      const ops = new GitHubStatOperations(
        mockConfig,
        {
          getTree: () =>
            Promise.resolve({
              tree: [
                {
                  path: "../outside.ts",
                  type: "blob",
                  sha: "outside",
                  size: 1,
                },
              ],
              truncated: false,
            }),
          repoId: "test-owner/test-repo",
        } as any,
        new FileCache(),
      );

      await assertRejects(
        () => ops.buildIndex(),
        TypeError,
        "repository tree path",
      );
    });
  });
});
