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
    retry: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      requestTimeout: 30000,
      totalTimeout: 120000,
      maxResponseBytes: 67108864,
    },
    cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
  };

  const mockClient = {
    getTree: () => Promise.resolve({ tree: [], truncated: false }),
    repoId: "test-owner/test-repo",
  } as any;

  function createOps(options?: {
    client?: Record<string, unknown>;
    cache?: FileCache;
  }): GitHubStatOperations {
    return new GitHubStatOperations(
      mockConfig,
      { ...mockClient, ...options?.client } as any,
      options?.cache ?? new FileCache(),
    );
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

  describe("index behavior", () => {
    it("does not hide index failures in exists", async () => {
      const ops = createOps({
        client: { getTree: () => Promise.reject(new Error("index unavailable")) },
      });

      await assertRejects(() => ops.exists("test.ts"), Error, "index unavailable");
    });

    it("returns false only for paths absent from a valid index", async () => {
      const ops = createOps();
      assertEquals(await ops.exists("missing.ts"), false);
    });

    it("partitions resolve cache entries by pages-prefix behavior", async () => {
      const ops = createOps({
        client: {
          getTree: () =>
            Promise.resolve({
              sha: "root",
              truncated: false,
              tree: [{ path: "pages/about.ts", type: "blob", sha: "about", size: 1 }],
            }),
        },
      });

      assertEquals(await ops.resolveFile("about", { allowPagesPrefix: false }), null);
      assertEquals(await ops.resolveFile("about"), "pages/about.ts");
      assertEquals(await ops.resolveFile("about", { allowPagesPrefix: false }), null);
    });
  });
});
