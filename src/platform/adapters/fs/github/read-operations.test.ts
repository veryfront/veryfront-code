import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { GitHubReadOperations } from "./read-operations.ts";

describe("GitHubReadOperations", () => {
  it("should export GitHubReadOperations class", () => {
    assertExists(GitHubReadOperations);
    assertEquals(typeof GitHubReadOperations, "function");
  });

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

  function createMockClient(overrides: Record<string, unknown> = {}) {
    return {
      getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==", encoding: "base64" }),
      getBlob: () => Promise.resolve({ content: "dGVzdA==", encoding: "base64" }),
      repoId: "test-owner/test-repo",
      ...overrides,
    };
  }

  function createMockCache(overrides: Record<string, unknown> = {}) {
    return {
      get: () => undefined,
      set: () => {},
      ...overrides,
    };
  }

  function createMockStatOps(overrides: Record<string, unknown> = {}) {
    return {
      getFileEntry: () => undefined,
      ...overrides,
    };
  }

  function createOps(opts?: {
    client?: Record<string, unknown>;
    cache?: Record<string, unknown>;
    statOps?: Record<string, unknown>;
    projectDir?: string;
  }): GitHubReadOperations {
    return new GitHubReadOperations(
      mockConfig,
      createMockClient(opts?.client) as any,
      createMockCache(opts?.cache) as any,
      createMockStatOps(opts?.statOps) as any,
      opts?.projectDir,
    );
  }

  describe("methods", () => {
    it("should be instantiable", () => {
      assertExists(createOps());
    });

    it("should have readTextFile method", () => {
      const ops = createOps();
      assertExists(ops.readTextFile);
      assertEquals(typeof ops.readTextFile, "function");
    });

    it("should have readFile method", () => {
      const ops = createOps();
      assertExists(ops.readFile);
      assertEquals(typeof ops.readFile, "function");
    });
  });

  describe("readTextFile", () => {
    it("should return cached value when available", async () => {
      const ops = createOps({
        cache: { get: () => "cached content", set: () => {} },
      });

      const result = await ops.readTextFile("test.txt");
      assertEquals(result, "cached content");
    });

    it("should decode base64 content from API", async () => {
      // "dGVzdA==" is base64 for "test"
      const ops = createOps();
      const result = await ops.readTextFile("test.txt");
      assertEquals(result, "test");
    });

    it("should accept an empty file", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "", encoding: "base64" }),
        },
      });

      assertEquals(await ops.readTextFile("empty.txt"), "");
    });

    it("should reject an unexpected content encoding", async () => {
      const ops = createOps({
        client: {
          getContents: () =>
            Promise.resolve({ type: "file", content: "dGVzdA==", encoding: "utf-8" }),
        },
      });

      await assertRejects(() => ops.readTextFile("test.txt"), Error, "base64");
    });

    it("should reject malformed base64 content", async () => {
      const ops = createOps({
        client: {
          getContents: () =>
            Promise.resolve({ type: "file", content: "not-base64%%%", encoding: "base64" }),
        },
      });

      await assertRejects(() => ops.readTextFile("test.txt"), Error, "base64");
    });

    it("should reject invalid UTF-8 when reading text", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "/w==", encoding: "base64" }),
        },
      });

      await assertRejects(() => ops.readTextFile("test.txt"), Error, "UTF-8");
    });

    it("should cache the result after fetching", async () => {
      let cachedKey = "";
      let cachedValue = "";
      const ops = createOps({
        cache: {
          get: () => undefined,
          set: (key: string, value: string) => {
            cachedKey = key;
            cachedValue = value;
          },
        },
      });

      await ops.readTextFile("test.txt");
      assertEquals(cachedValue, "test");
      assertEquals(cachedKey.includes("test.txt"), true);
    });

    it("should use blob API for large files", async () => {
      let blobCalled = false;
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==" }),
          getBlob: () => {
            blobCalled = true;
            return Promise.resolve({ content: "bGFyZ2U=", encoding: "base64" });
          },
        },
        statOps: {
          getFileEntry: () => ({ sha: "abc123", size: 2 * 1024 * 1024 }), // 2MB > 1MB limit
        },
      });

      const result = await ops.readTextFile("large-file.txt");
      assertEquals(blobCalled, true);
      assertEquals(result, "large");
    });

    it("should throw for directory paths", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve([{ type: "dir", name: "subdir" }]),
        },
      });

      await assertRejects(
        () => ops.readTextFile("somedir"),
        Error,
        "directory",
      );
    });

    it("should throw when file has no content", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: null }),
        },
      });

      await assertRejects(
        () => ops.readTextFile("empty.txt"),
        Error,
        "no content",
      );
    });

    it("should throw file-not-found for 404 errors", async () => {
      const notFoundErr = new Error("Not Found") as Error & { statusCode: number };
      notFoundErr.statusCode = 404;
      const ops = createOps({
        client: {
          getContents: () => Promise.reject(notFoundErr),
        },
      });

      await assertRejects(
        () => ops.readTextFile("missing.txt"),
        Error,
        "not found",
      );
    });

    it("should not cache a read that finishes after invalidation", async () => {
      let resolveFirst: ((value: unknown) => void) | undefined;
      const firstResponse = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      let calls = 0;
      const values = new Map<string, unknown>();
      const ops = createOps({
        client: {
          getContents: () => {
            calls++;
            if (calls === 1) return firstResponse;
            return Promise.resolve({
              type: "file",
              content: btoa("current"),
              encoding: "base64",
            });
          },
        },
        cache: {
          get: (key: string) => values.get(key),
          set: (key: string, value: unknown) => values.set(key, value),
        },
      });

      const staleRead = ops.readTextFile("test.txt");
      ops.invalidate();
      resolveFirst?.({ type: "file", content: btoa("stale"), encoding: "base64" });
      assertEquals(await staleRead, "stale");
      assertEquals(await ops.readTextFile("test.txt"), "current");
      assertEquals(calls, 2);
    });
  });

  describe("readFile (binary)", () => {
    it("should return cached bytes when available", async () => {
      const cached = new Uint8Array([1, 2, 3]);
      const ops = createOps({
        cache: { get: () => cached, set: () => {} },
      });

      const result = await ops.readFile("test.bin");
      assertEquals(result, cached);
    });

    it("should decode base64 to bytes from API", async () => {
      const ops = createOps();
      const result = await ops.readFile("test.bin");
      // "dGVzdA==" decodes to "test" = [116, 101, 115, 116]
      assertEquals(result instanceof Uint8Array, true);
      assertEquals(result.length, 4);
      assertEquals(result[0], 116); // 't'
    });

    it("should preserve bytes that are not valid UTF-8", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "/w==", encoding: "base64" }),
        },
      });

      assertEquals(await ops.readFile("test.bin"), new Uint8Array([255]));
    });

    it("should use blob API for large binary files", async () => {
      let blobCalled = false;
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==" }),
          getBlob: () => {
            blobCalled = true;
            return Promise.resolve({ content: "dGVzdA==", encoding: "base64" });
          },
        },
        statOps: {
          getFileEntry: () => ({ sha: "abc123", size: 2 * 1024 * 1024 }),
        },
      });

      const result = await ops.readFile("large.bin");
      assertEquals(blobCalled, true);
      assertEquals(result instanceof Uint8Array, true);
    });

    it("should handle blob with non-base64 encoding", async () => {
      const ops = createOps({
        client: {
          getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==" }),
          getBlob: () => Promise.resolve({ content: "plain text", encoding: "utf-8" }),
        },
        statOps: {
          getFileEntry: () => ({ sha: "abc123", size: 2 * 1024 * 1024 }),
        },
      });

      const result = await ops.readFile("plain.bin");
      assertEquals(result instanceof Uint8Array, true);
      // Should encode "plain text" as UTF-8 bytes
      assertEquals(new TextDecoder().decode(result), "plain text");
    });
  });
});
