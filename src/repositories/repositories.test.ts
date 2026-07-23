import "#veryfront/schemas/_test-setup.ts";
/**
 * Repository Layer Unit Tests
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";

import {
  buildScopedKey,
  createFileSystemRepository,
  createMemoryCacheRepository,
  createRepositoryContext,
  createRepositoryFactory,
  extractRepositoryContext,
  MemoryCacheRepository,
  RepositoryFactory,
} from "./index.ts";
import {
  createMockRepositoryContext,
  MockCacheRepository,
  MockFileSystemRepository,
} from "./testing/index.ts";
import type { HandlerContext } from "#veryfront/types";
import { createMockAdapter } from "#veryfront/platform";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { CacheRepositoryOptionsSchema, RepositoryContextSchema } from "./schemas/index.ts";

describe("Repository Types", () => {
  describe("RepositoryContext", () => {
    it("creates valid context", () => {
      const ctx = createRepositoryContext("my-project", "preview", "v1");
      assertEquals(ctx.projectId, "my-project");
      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.versionId, "v1");
    });

    it("has sensible defaults", () => {
      const ctx = createRepositoryContext("my-project");
      assertEquals(ctx.environment, "preview");
      assertEquals(ctx.versionId, "draft");
    });

    it("returns an immutable context snapshot", () => {
      const ctx = createRepositoryContext("my-project", "preview", "v1");
      assertEquals(Object.isFrozen(ctx), true);
      assertThrows(() => {
        (ctx as { projectId: string }).projectId = "other";
      });
    });

    it("rejects empty and unsafe identifiers", () => {
      assertThrows(() => createRepositoryContext("", "preview", "v1"));
      assertThrows(() => createRepositoryContext("project\nother", "preview", "v1"));
      assertThrows(() => createRepositoryContext("project", "preview", ""));
      assertThrows(() => createRepositoryContext("é".repeat(1000), "preview", "v1"));
    });

    it("rejects accessor-backed context fields without executing them", () => {
      let getterCalls = 0;
      const context = {
        get projectId() {
          getterCalls++;
          return "project";
        },
        environment: "preview",
        versionId: "v1",
      };

      assertThrows(() => buildScopedKey(context as Parameters<typeof buildScopedKey>[0], "key"));
      assertEquals(getterCalls, 0);
    });
  });

  describe("buildScopedKey", () => {
    it("builds project-scoped cache key", () => {
      const ctx = createRepositoryContext("proj123", "preview", "v1");
      const key = buildScopedKey(ctx, "manifest.json");
      assertEquals(key, "proj123:preview:v1:manifest.json");
    });

    it("encodes context delimiters and glob characters", () => {
      const ctx = createRepositoryContext("proj:one", "preview", "v*1");
      assertEquals(buildScopedKey(ctx, "manifest.json"), "proj%3Aone:preview:v%2A1:manifest.json");
    });

    it("rejects unsafe cache keys", () => {
      const ctx = createRepositoryContext("project", "preview", "v1");
      assertThrows(() => buildScopedKey(ctx, "line\nbreak"));
    });
  });
});

describe("Repository schemas", () => {
  it("rejects invalid contexts and dangerous cache options", () => {
    assertEquals(
      RepositoryContextSchema.safeParse({
        projectId: "",
        environment: "preview",
        versionId: "v1",
      }).success,
      false,
    );
    assertEquals(CacheRepositoryOptionsSchema.safeParse({ maxEntries: 0 }).success, false);
    assertEquals(
      CacheRepositoryOptionsSchema.safeParse({ defaultTtlSeconds: Infinity }).success,
      false,
    );
    assertEquals(
      RepositoryContextSchema.safeParse({
        projectId: "é".repeat(1000),
        environment: "preview",
        versionId: "v1",
      }).success,
      false,
    );
  });
});

describe("MemoryCacheRepository", () => {
  function createCtx(): ReturnType<typeof createRepositoryContext> {
    return createRepositoryContext("test", "preview", "v1");
  }

  it("gets and sets values", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    assertEquals(await cache.get("key1"), "value1");
  });

  it("detaches its namespace from mutable constructor input", async () => {
    const context = { projectId: "project", environment: "preview" as const, versionId: "v1" };
    const cache = new MemoryCacheRepository({ context });
    context.projectId = "other";

    await cache.set("key", "value");

    assertEquals(cache.context.projectId, "project");
    assertEquals(await cache.get("key"), "value");
  });

  it("returns null for missing keys", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });
    assertEquals(await cache.get("nonexistent"), null);
  });

  it("deletes values", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    await cache.delete("key1");
    assertEquals(await cache.get("key1"), null);
  });

  it("deletes by prefix", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("pages/index", "page1");
    await cache.set("pages/about", "page2");
    await cache.set("config/main", "config");

    const deleted = await cache.deleteByPrefix!("pages/");
    assertEquals(deleted, 2);

    assertEquals(await cache.get("pages/index"), null);
    assertEquals(await cache.get("pages/about"), null);
    assertEquals(await cache.get("config/main"), "config");
  });

  it("tracks stats", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1");
    await cache.get("key1"); // hit
    await cache.get("nonexistent"); // miss

    const stats = cache.getStats!();
    assertEquals(stats.sets, 1);
    assertEquals(stats.gets, 2);
    assertEquals(stats.hits, 1);
    assertEquals(stats.misses, 1);
    assertEquals(stats.hitRate, 0.5);
  });

  it("supports factory function", async () => {
    const cache = createMemoryCacheRepository(createCtx(), { maxEntries: 100 });

    await cache.set("key", "value");
    assertEquals(await cache.get("key"), "value");
  });

  it("expires entries for has checks", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1", 0.001);
    await new Promise((resolve) => setTimeout(resolve, 5));

    assertEquals(await cache.has!("key1"), false);
    assertEquals(await cache.get("key1"), null);
  });
});

describe("MockFileSystemRepository", () => {
  it("reads and writes files", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "test.txt": "hello" },
    });

    assertEquals(await mockFs.readFile("test.txt"), "hello");

    await mockFs.writeFile("new.txt", "world");
    assertEquals(await mockFs.readFile("new.txt"), "world");
  });

  it("tracks method calls", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
    });

    mockFs.setFile("test.txt", "content");
    await mockFs.readFile("test.txt");
    await mockFs.exists("test.txt");

    const readCalls = mockFs.getCalls("readFile");
    assertEquals(readCalls.length, 1);
    assertEquals(readCalls[0]?.args, ["test.txt"]);
    if (readCalls[0]) readCalls[0].args[0] = "mutated.txt";
    assertEquals(mockFs.getCalls("readFile")[0]?.args, ["test.txt"]);

    assertEquals((mockFs.getCalls("exists")).length, 1);
  });

  it("throws for missing files", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
    });

    await assertRejects(() => mockFs.readFile("nonexistent.txt"), Error, "ENOENT");
  });

  it("converts between text and bytes without changing content", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: {
        "bytes.txt": new TextEncoder().encode("hello"),
      },
    });

    assertEquals(await mockFs.readFile("bytes.txt"), "hello");

    await mockFs.writeFile("text.txt", "world");
    assertEquals(new TextDecoder().decode(await mockFs.readFileBytes("text.txt")), "world");
  });

  it("copies byte buffers and reports UTF-8 byte sizes", async () => {
    const input = new TextEncoder().encode("é");
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "unicode.txt": input },
    });
    input[0] = 0;

    const firstRead = await mockFs.readFileBytes("unicode.txt");
    assertEquals([...firstRead], [...new TextEncoder().encode("é")]);
    firstRead[0] = 0;
    assertEquals([...await mockFs.readFileBytes("unicode.txt")], [
      ...new TextEncoder().encode("é"),
    ]);
    assertEquals((await mockFs.stat("unicode.txt")).size, 2);

    mockFs.setFile("text.txt", "é");
    assertEquals((await mockFs.stat("text.txt")).size, 2);
  });

  it("preserves the root while creating absolute directories recursively", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
    });

    await mockFs.mkdir("/tmp/project/cache", { recursive: true });

    assertEquals(await mockFs.exists("/tmp"), true);
    assertEquals(await mockFs.exists("/tmp/project"), true);
    assertEquals(await mockFs.exists("/tmp/project/cache"), true);
  });

  it("supports recursive directory lifecycle", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: {
        "nested/child.txt": "child",
        "nested/subdir/grandchild.txt": "grandchild",
      },
    });

    assertEquals(await mockFs.exists("nested"), true);
    assertEquals((await mockFs.stat("nested")).isDirectory, true);

    await mockFs.mkdir("nested/generated/path", { recursive: true });
    assertEquals(await mockFs.exists("nested/generated"), true);
    assertEquals(await mockFs.exists("nested/generated/path"), true);

    const entryNames: string[] = [];
    for await (const entry of mockFs.readDir("nested")) {
      entryNames.push(entry.name);
    }

    assertEquals(entryNames.sort(), ["child.txt", "generated", "subdir"]);

    await mockFs.remove("nested/subdir", { recursive: true });
    assertEquals(await mockFs.exists("nested/subdir"), false);
    assertEquals(await mockFs.exists("nested/subdir/grandchild.txt"), false);
  });
});

describe("SecureFsRepository", () => {
  it("preserves valid UTF-8 bytes and rejects lossy binary writes", async () => {
    const adapter = createMockAdapter();
    const repository = createFileSystemRepository({
      baseDir: "/project",
      adapter,
      context: createRepositoryContext("project", "preview", "v1"),
    });
    const utf8 = new TextEncoder().encode("héllo");

    await repository.writeFile("valid.txt", utf8);
    assertEquals([...await repository.readFileBytes("valid.txt")], [...utf8]);
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    await repository.writeFile("bom.txt", withBom);
    assertEquals([...await repository.readFileBytes("bom.txt")], [...withBom]);
    await assertRejects(
      () => repository.writeFile("invalid.bin", new Uint8Array([0xff, 0x00])),
      Error,
      "UTF-8",
    );
    assertEquals(await repository.exists("invalid.bin"), false);
  });

  it("delegates the complete filesystem repository lifecycle", async () => {
    const adapter = createMockAdapter();
    const repository = createFileSystemRepository({
      baseDir: "/project",
      adapter,
      context: createRepositoryContext("project", "preview", "v1"),
    });

    await repository.mkdir("nested", { recursive: true });
    await repository.writeFile("nested/file.txt", "content");
    assertEquals(await repository.readFile("nested/file.txt"), "content");
    assertEquals(await repository.exists("nested/file.txt"), true);
    assertEquals((await repository.stat("nested/file.txt")).isFile, true);

    const entries: string[] = [];
    for await (const entry of repository.readDir("nested")) entries.push(entry.name);
    assertEquals(entries, ["file.txt"]);

    await repository.remove("nested", { recursive: true });
    assertEquals(await repository.exists("nested/file.txt"), false);
  });
});

describe("RepositoryFactory", () => {
  it("creates scoped filesystem, memory, and distributed repositories", async () => {
    const adapter = createMockAdapter();
    const mutableContext = {
      projectId: "project",
      environment: "preview" as const,
      versionId: "v1",
    };
    const factory = new RepositoryFactory({
      adapter,
      baseDir: "/project",
      context: mutableContext,
    });
    mutableContext.projectId = "other";

    assertEquals(factory.context.projectId, "project");
    const filesystem = factory.createFileSystemRepository();
    await filesystem.writeFile("file.txt", "content");
    assertEquals(await filesystem.readFile("file.txt"), "content");

    const memory = factory.createMemoryCacheRepository<string>({ maxEntries: 2 });
    await memory.set("memory", "value");
    assertEquals(await memory.get("memory"), "value");

    const distributed = factory.createCacheRepository(new MemoryCacheBackend());
    await distributed.set("distributed", "value");
    assertEquals(await distributed.get("distributed"), "value");
  });

  it("builds a factory from a resolved handler context", () => {
    const adapter = createMockAdapter();
    const factory = createRepositoryFactory({
      projectDir: "/project",
      adapter,
      securityConfig: null,
      cspUserHeader: null,
      projectId: "project",
      resolvedEnvironment: "preview",
      enriched: {
        projectId: "project",
        environment: "preview",
        contentSourceId: "preview-main",
      } as HandlerContext["enriched"],
    });

    assertEquals(factory.context, {
      projectId: "project",
      environment: "preview",
      versionId: "preview-main",
    });
  });
});

describe("MockCacheRepository", () => {
  it("gets and sets values", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });

    await mockCache.set("key", "value");
    assertEquals(await mockCache.get("key"), "value");
  });

  it("tracks method calls", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });

    await mockCache.set("key", "value");
    await mockCache.get("key");

    assertEquals((mockCache.getCalls("set")).length, 1);
    assertEquals((mockCache.getCalls("get")).length, 1);
  });

  it("supports initial values", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
      initial: { key1: "value1", key2: "value2" },
    });

    assertEquals(await mockCache.get("key1"), "value1");
    assertEquals(await mockCache.get("key2"), "value2");
  });

  it("can store undefined without treating it as a miss", async () => {
    const mockCache = new MockCacheRepository<undefined>({
      context: createMockRepositoryContext(),
      initial: { key: undefined },
    });

    assertEquals(await mockCache.get("key"), undefined);
    assertEquals(mockCache.getStats().hits, 1);
    assertEquals(mockCache.getStats().misses, 0);
  });

  it("honors entry TTLs and clear deletion statistics", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });
    await mockCache.set("short", "value", 0.001);
    await new Promise((resolve) => setTimeout(resolve, 5));

    assertEquals(await mockCache.get("short"), null);
    await mockCache.set("a", "1");
    await mockCache.set("b", "2");
    await mockCache.clear();

    assertEquals(mockCache.getStats(), {
      gets: 1,
      hits: 0,
      misses: 1,
      sets: 3,
      deletes: 2,
      hitRate: 0,
    });
  });

  it("deletes by prefix and resets tracked stats", async () => {
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
      initial: {
        "pages/home": "home",
        "pages/about": "about",
        "config/main": "config",
      },
    });

    assertEquals(await mockCache.deleteByPrefix("pages/"), 2);
    assertEquals(await mockCache.get("pages/home"), null);
    assertEquals(await mockCache.get("config/main"), "config");

    mockCache.resetStats();
    assertEquals(mockCache.getStats(), {
      gets: 0,
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
    });
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

  it("derives a canonical production content source from a release", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      resolvedEnvironment: "production",
      releaseId: "123",
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    assertEquals(ctx.projectId, "my-project");
    assertEquals(ctx.environment, "production");
    assertEquals(ctx.versionId, "release-123");
  });

  it("fails closed when the project identity is missing", () => {
    const handlerCtx: Partial<HandlerContext> = createBaseHandlerCtx();

    assertThrows(() => extractRepositoryContext(handlerCtx as HandlerContext));
  });

  it("extracts environment from requestContext.mode", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      releaseId: "release-123",
      requestContext: {
        mode: "production",
        token: "",
        slug: "",
        branch: null,
      },
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    assertEquals(ctx.environment, "production");
  });

  it("falls back to projectId and enriched release identifiers", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "project-from-id",
      enriched: {
        contentSourceId: "content-source-123",
      } as HandlerContext["enriched"],
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    assertEquals(ctx.projectId, "project-from-id");
    assertEquals(ctx.versionId, "content-source-123");
  });

  it("prefers resolvedEnvironment over requestContext.mode", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      resolvedEnvironment: "preview",
      requestContext: {
        mode: "production",
        token: "",
        slug: "",
        branch: null,
      },
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    assertEquals(ctx.environment, "preview");
  });

  it("prefers the fully enriched context for cache isolation", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "stale-project",
      projectSlug: "stale-slug",
      resolvedEnvironment: "preview",
      releaseId: "stale-release",
      enriched: {
        projectId: "canonical-project",
        projectSlug: "canonical-slug",
        environment: "production",
        contentSourceId: "release-canonical",
      } as HandlerContext["enriched"],
    };

    assertEquals(extractRepositoryContext(handlerCtx as HandlerContext), {
      projectId: "canonical-project",
      environment: "production",
      versionId: "release-canonical",
    });
  });

  it("derives a branch-specific preview version without a brittle draft fallback", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "project",
      requestContext: {
        mode: "preview",
        token: "",
        slug: "project",
        branch: "feature-a",
      },
    };

    assertEquals(
      extractRepositoryContext(handlerCtx as HandlerContext).versionId,
      "preview-feature-a",
    );
  });

  it("fails closed when a production context has no release identity", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "project",
      requestContext: {
        mode: "production",
        token: "",
        slug: "project",
        branch: null,
      },
    };

    assertThrows(() => extractRepositoryContext(handlerCtx as HandlerContext));
  });
});
