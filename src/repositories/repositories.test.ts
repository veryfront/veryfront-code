import "#veryfront/schemas/_test-setup.ts";
/**
 * Repository Layer Unit Tests
 */

import { describe, it } from "#std/testing/bdd";
import { expect } from "#std/expect";
import { FakeTime } from "#std/testing/time";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

import {
  buildScopedKey,
  createMemoryCacheRepository,
  createRepositoryContext,
  createRepositoryFactory,
  extractRepositoryContext,
  MemoryCacheRepository,
  RepositoryFactory,
  SecureFsRepository,
} from "./index.ts";
import { CacheRepositoryOptionsSchema, RepositoryContextSchema } from "./schemas/index.ts";
import {
  createMockRepositoryContext,
  MockCacheRepository,
  MockFileSystemRepository,
} from "./testing/index.ts";
import type { HandlerContext } from "#veryfront/types";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { FileSnapshotChangedError } from "#veryfront/platform/adapters/file-snapshot-error.ts";

describe("Repository Types", () => {
  describe("RepositoryContext", () => {
    it("creates valid context", () => {
      const ctx = createRepositoryContext("my-project", "preview", "v1");
      expect(ctx.projectId).toBe("my-project");
      expect(ctx.environment).toBe("preview");
      expect(ctx.versionId).toBe("v1");
      expect(Object.isFrozen(ctx)).toBe(true);
    });

    it("rejects missing, padded, and control-character identities", () => {
      for (const projectId of ["", " project", "project ", "project\nother"]) {
        expect(() => createRepositoryContext(projectId, "preview", "v1")).toThrow();
      }

      for (
        const versionId of [
          "",
          " version",
          "version ",
          "version\u0000other",
          "\uD800",
        ]
      ) {
        expect(() => createRepositoryContext("project", "preview", versionId)).toThrow();
      }
    });

    it("keeps exported schemas aligned with constructor invariants", () => {
      expect(() =>
        RepositoryContextSchema.parse({
          projectId: "",
          environment: "preview",
          versionId: "v1",
        })
      ).toThrow();
      expect(() =>
        RepositoryContextSchema.parse({
          projectId: "project",
          environment: "preview",
          versionId: "\uD800",
        })
      ).toThrow();
      expect(() =>
        CacheRepositoryOptionsSchema.parse({
          defaultTtlSeconds: Number.NaN,
          maxEntries: 0,
        })
      ).toThrow();
      for (const name of ["", " padded", "bad\u0000name", "\uD800"]) {
        expect(() => CacheRepositoryOptionsSchema.parse({ name })).toThrow();
      }
    });
  });

  describe("buildScopedKey", () => {
    it("builds a versioned project-scoped cache key", () => {
      const ctx = createRepositoryContext("proj123", "preview", "v1");
      const key = buildScopedKey(ctx, "manifest.json");
      expect(key).toBe("veryfront:repository:v1:proj123:preview:v1:manifest.json");
    });

    it("encodes every variable component without delimiter collisions", () => {
      const left = createRepositoryContext("a:preview:b", "preview", "c");
      const right = createRepositoryContext("a", "preview", "b:preview:c");

      expect(buildScopedKey(left, "d")).not.toBe(buildScopedKey(right, "d"));
      expect(buildScopedKey(left, "a*b?c")).toContain("a%2Ab%3Fc");
    });

    it("rejects malformed Unicode and overlong composed keys", () => {
      const ctx = createRepositoryContext("project", "preview", "v1");
      expect(() => buildScopedKey(ctx, "\uD800")).toThrow();
      expect(() => buildScopedKey(ctx, "x".repeat(64 * 1024))).toThrow();
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

  it("snapshots context instead of retaining caller-owned mutable state", async () => {
    const context = {
      projectId: "test",
      environment: "preview" as const,
      versionId: "v1",
    };
    const cache = new MemoryCacheRepository({ context });
    await cache.set("key", "value");

    context.projectId = "other";

    expect(cache.context.projectId).toBe("test");
    expect(Object.isFrozen(cache.context)).toBe(true);
    expect(await cache.get("key")).toBe("value");
  });

  it("expires entries for has checks", async () => {
    const cache = new MemoryCacheRepository({ context: createCtx() });

    await cache.set("key1", "value1", -1);

    expect(await cache.has!("key1")).toBe(false);
    expect(await cache.get("key1")).toBe(null);
  });
});

describe("RepositoryFactory", () => {
  it("snapshots repository identity at construction", () => {
    const context = {
      projectId: "project",
      environment: "preview" as const,
      versionId: "preview-main",
    };
    const factory = new RepositoryFactory({
      adapter: createMockAdapter(),
      baseDir: "/project",
      context,
    });

    context.projectId = "other";

    expect(factory.context.projectId).toBe("project");
    expect(Object.isFrozen(factory.context)).toBe(true);
  });

  it("wires filesystem, memory, and distributed repositories to one context", async () => {
    const adapter = createMockAdapter();
    const factory = createRepositoryFactory({
      adapter,
      projectDir: "/project",
      enriched: {
        projectId: "project",
        environment: "preview",
        contentSourceId: "preview-main",
      },
    } as unknown as HandlerContext);

    const filesystem = factory.createFileSystemRepository("internal");
    await filesystem.writeFile("factory.txt", "factory");
    expect(await filesystem.readFile("factory.txt")).toBe("factory");

    const memory = factory.createMemoryCacheRepository<string>();
    await memory.set("memory", "value");
    expect(await memory.get("memory")).toBe("value");

    const distributed = factory.createCacheRepository(new MemoryCacheBackend());
    await distributed.set("distributed", "value");
    expect(await distributed.get("distributed")).toBe("value");

    expect(filesystem.context).toEqual(factory.context);
    expect(memory.context).toEqual(factory.context);
    expect(distributed.context).toEqual(factory.context);
  });
});

describe("SecureFsRepository", () => {
  it("rejects a missing or unknown security context at runtime", () => {
    for (const securityContext of [undefined, "unknown"]) {
      expect(() =>
        new SecureFsRepository(
          {
            adapter: createMockAdapter(),
            baseDir: "/project",
            context: createMockRepositoryContext(),
            securityContext,
          } as unknown as ConstructorParameters<typeof SecureFsRepository>[0],
        )
      ).toThrow("securityContext");
    }
  });

  it("forwards text without lossy binary coercion", async () => {
    const adapter = createMockAdapter();
    const repository = new SecureFsRepository({
      adapter,
      baseDir: "/project",
      context: createMockRepositoryContext(),
      securityContext: "internal",
    });

    await repository.writeFile("text.txt", "hello");

    expect(adapter.fs.files.get("/project/text.txt")).toBe("hello");
    await expect(
      (repository.writeFile as unknown as (path: string, value: unknown) => Promise<void>)(
        "binary.dat",
        new Uint8Array([0xff, 0x00, 0x61]),
      ),
    ).rejects.toThrow("text content");
    expect(adapter.fs.files.has("/project/binary.dat")).toBe(false);
  });

  it("delegates the complete text filesystem lifecycle through SecureFs", async () => {
    const repository = new SecureFsRepository({
      adapter: createMockAdapter(),
      baseDir: "/project",
      context: createMockRepositoryContext(),
      securityContext: "internal",
    });

    await repository.mkdir("nested", { recursive: true });
    await repository.writeFile("nested/file.txt", "héllo");

    expect(await repository.readFile("nested/file.txt")).toBe("héllo");
    expect(new TextDecoder().decode(await repository.readFileBytes("nested/file.txt"))).toBe(
      "héllo",
    );
    expect(await repository.exists("nested/file.txt")).toBe(true);
    expect((await repository.stat("nested/file.txt")).isFile).toBe(true);

    const entries = [];
    for await (const entry of repository.readDir("nested")) entries.push(entry);
    expect(entries.map((entry) => entry.name)).toEqual(["file.txt"]);

    await repository.remove("nested/file.txt");
    expect(await repository.exists("nested/file.txt")).toBe(false);
  });

  it("advertises and forwards root-bound snapshots only when the adapter does", async () => {
    const capable = createMockAdapter();
    let received: [string, string, number] | undefined;
    capable.fs.readFileSnapshotWithinLimit = (path, root, byteLimit) => {
      received = [path, root, byteLimit];
      return Promise.resolve(new Uint8Array([1, 2]));
    };
    const repository = new SecureFsRepository({
      adapter: capable,
      baseDir: "/project",
      context: createMockRepositoryContext(),
      securityContext: "internal",
    });

    expect([...await repository.readFileSnapshotWithinLimit!("asset.bin", 2)]).toEqual([1, 2]);
    expect(received).toEqual(["/project/asset.bin", "/project", 2]);

    const incapable = createMockAdapter();
    Reflect.deleteProperty(incapable.fs, "readFileSnapshotWithinLimit");
    const repositoryWithoutSnapshot = new SecureFsRepository({
      adapter: incapable,
      baseDir: "/project",
      context: createMockRepositoryContext(),
      securityContext: "internal",
    });
    expect(repositoryWithoutSnapshot.readFileSnapshotWithinLimit).toBe(undefined);
    expect("readFileSnapshotWithinLimit" in repositoryWithoutSnapshot).toBe(false);
  });

  it("recovers bounded and whole-file repository capabilities with exact limits", async () => {
    const adapter = createMockAdapter();
    const calls: Array<[string, string, number]> = [];
    adapter.fs.maxWholeFileReadBytes = 8;
    adapter.fs.readFileBytesBounded = (path, byteLimit) => {
      calls.push(["bounded", path, byteLimit]);
      return Promise.resolve(new Uint8Array([1]));
    };
    adapter.fs.readFileBytesWithinLimit = (path, byteLimit) => {
      calls.push(["exact", path, byteLimit]);
      return Promise.resolve(new Uint8Array([2]));
    };
    const repository = new SecureFsRepository({
      adapter,
      baseDir: "/project",
      context: createMockRepositoryContext(),
      securityContext: "internal",
    });

    expect(repository.maxWholeFileReadBytes).toBe(8);
    expect([...await repository.readFileBytesBounded!("asset.bin", 3)]).toEqual([1]);
    expect([...await repository.readFileBytesWithinLimit!("asset.bin", 4)]).toEqual([2]);
    expect(calls).toEqual([
      ["bounded", "/project/asset.bin", 3],
      ["exact", "/project/asset.bin", 4],
    ]);
  });

  it("preserves snapshot source-change and range error classification", async () => {
    for (
      const error of [
        new FileSnapshotChangedError("changed"),
        new RangeError("oversized"),
      ]
    ) {
      const adapter = createMockAdapter();
      adapter.fs.readFileSnapshotWithinLimit = () => Promise.reject(error);
      const repository = new SecureFsRepository({
        adapter,
        baseDir: "/project",
        context: createMockRepositoryContext(),
        securityContext: "internal",
      });

      await expect(repository.readFileSnapshotWithinLimit!("asset.bin", 4)).rejects.toBe(error);
    }
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

  it("converts between text and bytes without changing content", async () => {
    const source = new TextEncoder().encode("hello");
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: {
        "bytes.txt": source,
      },
    });

    source[0] = "j".charCodeAt(0);
    expect(await mockFs.readFile("bytes.txt")).toBe("hello");

    await mockFs.writeFile("text.txt", "world");
    expect(new TextDecoder().decode(await mockFs.readFileBytes("text.txt"))).toBe("world");

    const firstRead = await mockFs.readFileBytes("bytes.txt");
    firstRead[0] = "j".charCodeAt(0);
    expect(new TextDecoder().decode(await mockFs.readFileBytes("bytes.txt"))).toBe("hello");
  });

  it("rejects a snapshot when the stored generation is replaced during the read", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "asset.bin": new Uint8Array([1, 2, 3]) },
    });

    const read = mockFs.readFileSnapshotWithinLimit!("asset.bin", 3);
    mockFs.setFile("asset.bin", new Uint8Array([4, 5, 6]));

    await expect(read).rejects.toBeInstanceOf(FileSnapshotChangedError);
  });

  it("supports recursive directory lifecycle", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: {
        "nested/child.txt": "child",
        "nested/subdir/grandchild.txt": "grandchild",
      },
    });

    await mockFs.mkdir("nested/generated/path", { recursive: true });
    expect(await mockFs.exists("nested/generated")).toBe(true);
    expect(await mockFs.exists("nested/generated/path")).toBe(true);

    const entryNames: string[] = [];
    for await (const entry of mockFs.readDir("nested")) {
      entryNames.push(entry.name);
    }

    expect(entryNames.sort()).toEqual(["child.txt", "generated", "subdir"]);

    await mockFs.remove("nested/subdir", { recursive: true });
    expect(await mockFs.exists("nested/subdir")).toBe(false);
    expect(await mockFs.exists("nested/subdir/grandchild.txt")).toBe(false);
  });

  it("lists relative root entries through the dot path", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: {
        "root.txt": "root",
        "nested/child.txt": "child",
      },
    });
    const entries = [];

    for await (const entry of mockFs.readDir(".")) entries.push(entry);

    expect(entries.map((entry) => entry.name).sort()).toEqual(["nested", "root.txt"]);
  });

  it("reports byte size rather than UTF-16 string length", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "unicode.txt": "é" },
    });

    expect((await mockFs.stat("unicode.txt")).size).toBe(2);
  });

  it("models missing-parent, missing-path, and non-empty-directory failures", async () => {
    const mockFs = new MockFileSystemRepository({
      context: createMockRepositoryContext(),
      files: { "nested/file.txt": "value" },
    });
    const consumeDirectory = async (path: string): Promise<void> => {
      for await (const _entry of mockFs.readDir(path)) {
        // Iteration itself is the operation under test.
      }
    };

    await expect(mockFs.writeFile("missing/file.txt", "value")).rejects.toThrow("ENOENT");
    await expect(mockFs.mkdir("missing/child")).rejects.toThrow("ENOENT");
    await expect(mockFs.remove("missing")).rejects.toThrow("ENOENT");
    await expect(mockFs.remove("nested")).rejects.toThrow("ENOTEMPTY");
    await expect(consumeDirectory("missing")).rejects.toThrow("ENOENT");

    expect(await mockFs.readFile("nested/file.txt")).toBe("value");
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

  it("honors TTL at the exact expiry boundary", async () => {
    using time = new FakeTime();
    const mockCache = new MockCacheRepository({
      context: createMockRepositoryContext(),
    });
    await mockCache.set("key", "value", 1);

    time.tick(1_000);

    expect(await mockCache.has("key")).toBe(false);
    expect(await mockCache.get("key")).toBe(null);
    expect(mockCache.size).toBe(0);
  });

  it("distinguishes an explicitly stored undefined value from a miss", async () => {
    const mockCache = new MockCacheRepository<string | undefined>({
      context: createMockRepositoryContext(),
    });

    await mockCache.set("key", undefined);

    expect(await mockCache.get("key")).toBe(undefined);
    expect(await mockCache.has("key")).toBe(true);
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

    expect(await mockCache.deleteByPrefix("pages/")).toBe(2);
    expect(await mockCache.get("pages/home")).toBe(null);
    expect(await mockCache.get("config/main")).toBe("config");

    mockCache.resetStats();
    expect(mockCache.getStats()).toEqual({
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

  it("derives preview identity from the request branch", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      resolvedEnvironment: "preview",
      requestContext: {
        mode: "preview",
        token: "",
        slug: "my-project",
        branch: "feature/cache",
      },
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.projectId).toBe("my-project");
    expect(ctx.environment).toBe("preview");
    expect(ctx.versionId).toBe("preview-feature/cache");
  });

  it("fails closed when project identity is missing", () => {
    const handlerCtx: Partial<HandlerContext> = createBaseHandlerCtx();

    expect(() => extractRepositoryContext(handlerCtx as HandlerContext)).toThrow(
      "projectId or projectSlug",
    );
  });

  it("fails closed when environment identity is missing", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "project",
    };

    expect(() => extractRepositoryContext(handlerCtx as HandlerContext)).toThrow(
      "environment",
    );
  });

  it("fails closed when production release identity is missing", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectSlug: "my-project",
      requestContext: {
        mode: "production",
        token: "",
        slug: "",
        branch: null,
      },
    };

    expect(() => extractRepositoryContext(handlerCtx as HandlerContext)).toThrow("releaseId");
  });

  it("uses enriched context as the authoritative identity snapshot", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "stale-top-level-id",
      projectSlug: "stale-top-level-slug",
      enriched: {
        projectId: "project-from-enriched",
        environment: "production",
        contentSourceId: "content-source-123",
      } as HandlerContext["enriched"],
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.projectId).toBe("project-from-enriched");
    expect(ctx.environment).toBe("production");
    expect(ctx.versionId).toBe("content-source-123");
  });

  it("prefers stable projectId and resolved environment over request values", () => {
    const handlerCtx: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "stable-id",
      projectSlug: "mutable-slug",
      resolvedEnvironment: "production",
      releaseId: "release-123",
      requestContext: {
        mode: "preview",
        token: "",
        slug: "mutable-slug",
        branch: "feature",
      },
    };

    const ctx = extractRepositoryContext(handlerCtx as HandlerContext);
    expect(ctx.projectId).toBe("stable-id");
    expect(ctx.environment).toBe("production");
    expect(ctx.versionId).toBe("release-release-123");
  });

  it("distinguishes local source identity from remote preview identity", () => {
    const base: Partial<HandlerContext> = {
      ...createBaseHandlerCtx(),
      projectId: "project",
      resolvedEnvironment: "preview",
      requestContext: {
        mode: "preview",
        token: "",
        slug: "project",
        branch: "feature",
      },
    };

    expect(
      extractRepositoryContext({ ...base, isLocalProject: true } as HandlerContext).versionId,
    ).toBe("local-feature");
    expect(
      extractRepositoryContext({ ...base, isLocalProject: false } as HandlerContext).versionId,
    ).toBe("preview-feature");
  });
});
