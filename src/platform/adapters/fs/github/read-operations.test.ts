import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildGitHubBytesCacheKey } from "#veryfront/cache";
import { GitHubReadOperations } from "./read-operations.ts";
import { buildGitHubCacheRef } from "./cache-scope.ts";
import { FileCache } from "../cache/file-cache.ts";

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
    retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000 },
    cache: { enabled: true, ttl: 60000, maxSize: 1000, maxMemory: 104857600 },
  };

  function createMockClient(overrides: Record<string, unknown> = {}) {
    return {
      getContents: () => Promise.resolve({ type: "file", content: "dGVzdA==" }),
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

  describe("readFileBytesWithinLimit", () => {
    function seedExactCache(cache: FileCache, sha: string, bytes: Uint8Array): void {
      cache.set(
        `${buildGitHubBytesCacheKey(buildGitHubCacheRef(mockConfig), "README.md")}:exact:${sha}`,
        bytes,
      );
    }

    it("rejects a cached entry whose length disagrees with the tree entry", async () => {
      const cache = new FileCache();
      seedExactCache(cache, "sha-1", new Uint8Array(5));
      const ops = new GitHubReadOperations(
        mockConfig,
        createMockClient() as any,
        cache as any,
        createMockStatOps({
          getFileEntry: () => ({ sha: "sha-1", size: 11, type: "blob" }),
        }) as any,
      );

      await assertRejects(
        () => ops.readFileBytesWithinLimit("README.md", 11),
        TypeError,
        "does not match its tree entry",
      );
    });

    it("returns a cached entry whose length matches without refetching", async () => {
      const cache = new FileCache();
      const content = new TextEncoder().encode("hello world");
      seedExactCache(cache, "sha-1", content);
      let blobFetches = 0;
      const ops = new GitHubReadOperations(
        mockConfig,
        createMockClient({
          getBlobBytesWithinLimit: () => {
            blobFetches++;
            throw new Error("the cached entry must answer the read");
          },
        }) as any,
        cache as any,
        createMockStatOps({
          getFileEntry: () => ({ sha: "sha-1", size: content.byteLength, type: "blob" }),
        }) as any,
      );

      const bytes = await ops.readFileBytesWithinLimit("README.md", content.byteLength);
      assertEquals(
        new TextDecoder().decode(bytes),
        "hello world",
        "a size-matching cached entry is served verbatim",
      );
      assertEquals(blobFetches, 0, "a size-matching cached entry is served without a blob fetch");
    });
  });

  describe("cache scoping", () => {
    it("isolates content cache entries by repository", async () => {
      const cache = new FileCache();
      // "Zmlyc3Q=" is base64 for "first"; "c2Vjb25k" is base64 for "second".
      const first = new GitHubReadOperations(
        mockConfig,
        createMockClient({
          getContents: () => Promise.resolve({ type: "file", content: "Zmlyc3Q=" }),
        }) as any,
        cache as any,
        createMockStatOps() as any,
      );
      const second = new GitHubReadOperations(
        { ...mockConfig, repo: "other-repo" },
        createMockClient({
          getContents: () => Promise.resolve({ type: "file", content: "c2Vjb25k" }),
        }) as any,
        cache as any,
        createMockStatOps() as any,
      );

      assertEquals(await first.readTextFile("src/data.txt"), "first");
      assertEquals(await second.readTextFile("src/data.txt"), "second");
    });
  });
});
