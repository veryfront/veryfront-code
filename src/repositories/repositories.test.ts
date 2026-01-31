/**
 * Repository Layer Unit Tests
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  buildScopedKey,
  createMemoryCacheRepository,
  createRepositoryContext,
  extractRepositoryContext,
  MemoryCacheRepository,
} from "./index.ts";
import {
  createMockRepositoryContext,
  MockCacheRepository,
  MockFileSystemRepository,
} from "./testing/index.ts";
import type { HandlerContext } from "#veryfront/types";

describe("Repository Types", () => {
  describe("RepositoryContext", () => {
    it("creates valid context", () => {
      const ctx = createRepositoryContext("my-project", "preview", "v1");
      expect(ctx.projectId).toBe("my-project");
      expect(ctx.environment).toBe("preview");
      expect(ctx.versionId).toBe("v1");
    });

    it("has sensible defaults", () => {
      const ctx = createRepositoryContext("my-project");
      expect(ctx.environment).toBe("preview");
      expect(ctx.versionId).toBe("draft");
    });
  });

  describe("buildScopedKey", () => {
    it("builds project-scoped cache key", () => {
      const ctx = createRepositoryContext("proj123", "preview", "v1");
      const key = buildScopedKey(ctx, "manifest.json");
      expect(key).toBe("proj123:preview:v1:manifest.json");
    });
  });
});

describe("MemoryCacheRepository", () => {
  function createCtx(): ReturnType<typeof createRepositoryContext> {
    return createRepositoryContext("test", "preview", "v1");
  }

  it("gets and sets values", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");
  });

  it("returns null for missing keys", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });
    expect(await cache.get("nonexistent")).toBe(null);
  });

  it("deletes values", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    await cache.delete("key1");
    expect(await cache.get("key1")).toBe(null);
  });

  it("deletes by prefix", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("pages/index", "page1");
    await cache.set("pages/about", "page2");
    await cache.set("config/main", "config");

    const deleted = await cache.deleteByPrefix!("pages/");
    expect(deleted).toBe(2);

    expect(await cache.get("pages/index")).toBe(null);
    expect(await cache.get("pages/about")).toBe(null);
    expect(await cache.get("config/main")).toBe("config");
  });

  it("tracks stats", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    await cache.get("key1"); // hit
    await cache.get("nonexistent"); // miss

    const stats = cache.getStats!();
    expect(stats.sets).toBe(1);
    expect(stats.gets).toBe(2);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it("supports factory function", async () => {
    const cache = createMemoryCacheRepository(createCtx(), { maxEntries: 100 });

    await cache.set("key", "value");
    expect(await cache.get("key")).toBe("value");
  });
});

describe("MockFileSystemRepository", () => {
  it("reads and writes files", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "test.txt": "hello" },
    });

    expect(await mockFs.readFile("test.txt")).toBe("hello");

    await mockFs.writeFile("new.txt", "world");
    expect(await mockFs.readFile("new.txt")).toBe("world");
  });

  it("tracks method calls", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
    });

    mockFs.setFile("test.txt", "content");
    await mockFs.readFile("test.txt");
    await mockFs.exists("test.txt");

    const readCalls = mockFs.getCalls("readFile");
    expect(readCalls).toHaveLength(1);
    expect(readCalls[0]?.args).toEqual(["test.txt"]);

    expect(mockFs.getCalls("exists")).toHaveLength(1);
  });

  it("throws for missing files", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
    });

    await expect(mockFs.readFile("nonexistent.txt")).rejects.toThrow("ENOENT");
  });
});

describe("MockCacheRepository", () => {
  it("gets and sets values", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });

    await mockCache.set("key", "value");
    expect(await mockCache.get("key")).toBe("value");
  });

  it("tracks method calls", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });

    await mockCache.set("key", "value");
    await mockCache.get("key");

    expect(mockCache.getCalls("set")).toHaveLength(1);
    expect(mockCache.getCalls("get")).toHaveLength(1);
  });

  it("supports initial values", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
      initial: { key1: "value1", key2: "value2" },
    });

    expect(await mockCache.get("key1")).toBe("value1");
    expect(await mockCache.get("key2")).toBe("value2");
  });
});

describe("extractRepositoryContext", () => {
  function createBaseHandlerCtx(): Partial<HandlerContext> {
    return {
      projectDir: "/path/to/project",
      adapter: {} as HandlerContext["adapter"],
      securityConfig: null,
      cspUserHeader: null,
    };
  }

  it("extracts context from handler with projectSlug", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      resolvedEnvironment: "preview",
      releaseId: "release-123",
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.projectId).toBe("my-project");
    expect(ctx.environment).toBe("preview");
    expect(ctx.versionId).toBe("release-123");
  });

  it("uses defaults for missing fields", () => {
    const handlerCtx: Partial<HandlerContext> = createBaseHandlerCtx();

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.projectId).toBe("unknown");
    expect(ctx.environment).toBe("preview");
    expect(ctx.versionId).toBe("draft");
  });

  it("extracts environment from requestContext.mode", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      requestContext: {
        mode: "production",
        token: "",
        slug: "",
        branch: null,
        isLocalDev: false,
      },
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.environment).toBe("production");
  });
});
