import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  type StaticFileOptions,
  StaticFileService,
} from "./static-file.service.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors/error-registry.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";

function makeOptions(overrides: Partial<StaticFileOptions> = {}): StaticFileOptions {
  return {
    projectDir: "/project",
    adapter: {
      fs: {
        stat: async () => {
          throw new Error("not found");
        },
        readFile: async () => "",
        readFileBytes: async () => new Uint8Array(),
        exists: async () => false,
      },
    } as any,
    isPreviewMode: false,
    isLocalProject: false,
    ...overrides,
  };
}

function createMockFsRepo(
  files: Map<string, Uint8Array>,
): FileSystemRepository {
  return {
    readFile: async (path: string) => {
      const data = files.get(toMockAbsolutePath(path));
      if (!data) throw new Error("not found");
      return new TextDecoder().decode(data);
    },
    readFileBytes: async (path: string) => {
      const data = files.get(toMockAbsolutePath(path));
      if (!data) throw new Error("not found");
      return data;
    },
    stat: async (path: string) => {
      if (files.has(toMockAbsolutePath(path))) {
        return { isFile: true, isDirectory: false, mtime: new Date() };
      }
      throw createFsError("not found", "ENOENT");
    },
  } as unknown as FileSystemRepository;
}

function createManifestFsRepo(
  fileName: string,
  content: string,
  options: {
    mtime?: Date | null;
    beforeManifestRead?: () => Promise<void>;
    onManifestRead?: () => void;
  } = {},
): FileSystemRepository {
  const manifestPath = "/project/dist/_veryfront/manifest.json";
  const assetPath = `/project/dist/_veryfront/${fileName}`;
  const manifest = JSON.stringify({
    chunks: { chunks: { main: { file: fileName } }, shared: [] },
    routes: [],
  });

  return {
    readFile: async (path: string) => {
      if (toMockAbsolutePath(path) !== manifestPath) {
        throw createFsError("not found", "ENOENT");
      }
      options.onManifestRead?.();
      await options.beforeManifestRead?.();
      return manifest;
    },
    readFileBytes: async (path: string) => {
      if (toMockAbsolutePath(path) !== assetPath) {
        throw createFsError("not found", "ENOENT");
      }
      return new TextEncoder().encode(content);
    },
    stat: async (path: string) => {
      const absolutePath = toMockAbsolutePath(path);
      if (absolutePath === manifestPath || absolutePath === assetPath) {
        return {
          isFile: true,
          isDirectory: false,
          mtime: options.mtime === undefined ? new Date(1) : options.mtime,
        };
      }
      throw createFsError("not found", "ENOENT");
    },
  } as unknown as FileSystemRepository;
}

function createFsError(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function toMockAbsolutePath(path: string): string {
  return path.startsWith("/") ? path : `/project/${path}`;
}

function resolveManifestAssetForTest(
  service: StaticFileService,
  requestPath: string,
  options: StaticFileOptions,
  fs: FileSystemRepository,
): Promise<string | null> {
  return (service as unknown as {
    resolveManifestAsset(
      requestPath: string,
      options: StaticFileOptions,
      fs: FileSystemRepository,
    ): Promise<string | null>;
  }).resolveManifestAsset(requestPath, options, fs);
}

async function withTempProject(
  run: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await Deno.makeTempDir({ prefix: "veryfront-static-service-" });
  try {
    await run(projectDir);
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

afterEach(() => {
  __injectDepsForTests(null);
});

describe("server/services/static/static-file.service", () => {
  describe("StaticFileService", () => {
    it("should be constructable without options", () => {
      const service = new StaticFileService();
      assertEquals(service instanceof StaticFileService, true);
    });

    it("should be constructable with FileSystemRepository", () => {
      const repo = createMockFsRepo(new Map());
      const service = new StaticFileService(repo);
      assertEquals(service instanceof StaticFileService, true);
    });
  });

  describe("isAssetRequest", () => {
    const service = new StaticFileService();

    it("returns true for .js files", () => {
      assertEquals(service.isAssetRequest("/app.js"), true);
    });

    it("returns true for .css files", () => {
      assertEquals(service.isAssetRequest("/styles.css"), true);
    });

    it("returns true for /_veryfront/ paths", () => {
      assertEquals(service.isAssetRequest("/_veryfront/chunk.js"), true);
    });

    it("accepts generated image variants under /_vf/assets/images", () => {
      assertEquals(
        service.isAssetRequest("/_vf/assets/images/hero-640w-q80.webp"),
        true,
      );
    });

    it("returns false for .md files", () => {
      assertEquals(service.isAssetRequest("/readme.md"), false);
    });

    it("returns false for /.veryfront/ paths", () => {
      assertEquals(service.isAssetRequest("/.veryfront/config"), false);
    });

    it("returns false for dotfiles", () => {
      assertEquals(service.isAssetRequest("/.env"), false);
    });

    it("returns false for dotfile in subdirectory", () => {
      assertEquals(service.isAssetRequest("/src/.hidden/file"), false);
    });

    it("returns true for .well-known paths", () => {
      assertEquals(service.isAssetRequest("/.well-known/security.txt"), true);
    });

    it("returns false for paths without dots", () => {
      assertEquals(service.isAssetRequest("/about"), false);
    });

    it("returns true for image files", () => {
      assertEquals(service.isAssetRequest("/logo.png"), true);
    });
  });

  describe("clearCache", () => {
    it("does not throw", () => {
      StaticFileService.clearCache();
    });
  });

  describe("determineCacheStrategy (via resolveFile)", () => {
    it("returns no-cache for preview mode non-local project", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("body{}");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/style.css", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isPreviewMode: true, isLocalProject: false });

      const result = await service.resolveFile("/style.css", options);
      if (result) {
        assertEquals(result.cacheStrategy, "no-cache");
      }
    });

    it("returns immutable for hashed filename", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("content");
      // hasHashedFilename requires 8+ hex chars between dots: .a1b2c3d4.
      const files = new Map<string, Uint8Array>([
        ["/project/dist/app.a1b2c3d4e5f6.js", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isPreviewMode: false, isLocalProject: false });

      const result = await service.resolveFile("/app.a1b2c3d4e5f6.js", options);
      if (result) {
        assertEquals(result.cacheStrategy, "immutable");
      }
    });

    it("returns medium for regular public file", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<svg/>");
      const files = new Map<string, Uint8Array>([
        ["/project/public/logo.svg", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isPreviewMode: false, isLocalProject: true });

      const result = await service.resolveFile("/logo.svg", options);
      if (result) {
        assertEquals(result.cacheStrategy, "medium");
      }
    });
  });

  describe("manifest resolution", () => {
    it("resolves file from manifest when manifest exists", async () => {
      const manifest = {
        chunks: {
          chunks: {
            main: { file: "app.js" },
          },
          shared: [],
        },
        routes: [],
      };
      const manifestJson = JSON.stringify(manifest);
      const fileData = new TextEncoder().encode("app code");

      const files = new Map<string, Uint8Array>([
        ["/project/dist/_veryfront/manifest.json", new TextEncoder().encode(manifestJson)],
        ["/project/dist/_veryfront/app.js", fileData],
      ]);
      const repo = createMockFsRepo(files);

      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const service = new StaticFileService(repo);
      const options = makeOptions();

      const result = await service.resolveFile("/_veryfront/app.js", options);
      assertExists(result);
      assertEquals(result.path, "/project/dist/_veryfront/app.js");
      assertEquals(result.source, "manifest");
      assertEquals(result.data, fileData);
    });

    it("does not coalesce manifest loads across filesystem owners sharing a projectDir", async () => {
      StaticFileService.clearCache();
      const firstReadStarted = Promise.withResolvers<void>();
      const releaseFirstRead = Promise.withResolvers<void>();
      let firstManifestReads = 0;
      let secondManifestReads = 0;
      const firstService = new StaticFileService(
        createManifestFsRepo("first.js", "first owner", {
          onManifestRead: () => {
            firstManifestReads++;
            firstReadStarted.resolve();
          },
          beforeManifestRead: () => releaseFirstRead.promise,
        }),
      );
      const secondService = new StaticFileService(
        createManifestFsRepo("second.js", "second owner", {
          onManifestRead: () => secondManifestReads++,
        }),
      );

      const firstResultPromise = firstService.resolveFile(
        "/_veryfront/first.js",
        makeOptions(),
      );
      await firstReadStarted.promise;
      const secondResultPromise = secondService.resolveFile(
        "/_veryfront/second.js",
        makeOptions(),
      );
      await Promise.resolve();
      releaseFirstRead.resolve();

      const [firstResult, secondResult] = await Promise.all([
        firstResultPromise,
        secondResultPromise,
      ]);
      assertEquals(firstManifestReads, 1);
      assertEquals(secondManifestReads, 1);
      assertEquals(firstResult?.source, "manifest");
      assertEquals(secondResult?.source, "manifest");
      assertEquals(
        new TextDecoder().decode(secondResult?.data),
        "second owner",
      );
    });

    it("bounds manifest entries per filesystem owner with LRU eviction", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({
        manifestCache,
        manifestLoading,
        manifestCacheMaxEntries: 2,
      });
      let manifestReads = 0;
      const service = new StaticFileService(
        createManifestFsRepo("app.js", "bounded", {
          onManifestRead: () => manifestReads++,
        }),
      );

      for (const manifestCacheIdentity of ["release-a", "release-b", "release-c"]) {
        const result = await service.resolveFile(
          "/_veryfront/app.js",
          makeOptions({ manifestCacheIdentity }),
        );
        assertEquals(result?.source, "manifest");
      }

      assertEquals(manifestCache.size, 2);
      assertEquals(manifestLoading.size, 0);
      assertEquals(manifestReads, 3);

      await service.resolveFile(
        "/_veryfront/app.js",
        makeOptions({ manifestCacheIdentity: "release-a" }),
      );
      assertEquals(manifestReads, 4, "The least-recently-used release must be reloaded");
      assertEquals(manifestCache.size, 2);
    });

    it("does not let an evicted in-flight load repopulate a full owner cache", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({
        manifestCache,
        manifestLoading,
        manifestCacheMaxEntries: 1,
      });
      const firstReadStarted = Promise.withResolvers<void>();
      const releaseFirstRead = Promise.withResolvers<void>();
      let activeFile = "old.js";
      let manifestReads = 0;
      const manifestPath = "/project/dist/_veryfront/manifest.json";
      const repo = {
        readFile: async () => {
          const fileSnapshot = activeFile;
          manifestReads++;
          if (manifestReads === 1) {
            firstReadStarted.resolve();
            await releaseFirstRead.promise;
          }
          return JSON.stringify({
            chunks: { chunks: { main: { file: fileSnapshot } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: async (path: string) => new TextEncoder().encode(toMockAbsolutePath(path)),
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (
            absolutePath === manifestPath ||
            absolutePath === "/project/dist/_veryfront/old.js" ||
            absolutePath === "/project/dist/_veryfront/new.js"
          ) {
            return { isFile: true, isDirectory: false, mtime: new Date(1) };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);

      const oldResultPromise = service.resolveFile(
        "/_veryfront/old.js",
        makeOptions({ manifestCacheIdentity: "release-old" }),
      );
      await firstReadStarted.promise;
      activeFile = "new.js";
      const newResult = await service.resolveFile(
        "/_veryfront/new.js",
        makeOptions({ manifestCacheIdentity: "release-new" }),
      );
      releaseFirstRead.resolve();
      await oldResultPromise;

      assertEquals(newResult?.source, "manifest");
      assertEquals(manifestLoading.size, 0);
      assertEquals(manifestCache.size, 1);
      const activeIndex = [...manifestCache.values()][0] as {
        assets: Map<string, string>;
      };
      assertEquals(activeIndex.assets.has("/_veryfront/new.js"), true);
      assertEquals(activeIndex.assets.has("/_veryfront/old.js"), false);
    });

    it("prevents a cleared in-flight manifest load from overwriting a newer load", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({ manifestCache, manifestLoading });
      const firstReadStarted = Promise.withResolvers<void>();
      const releaseFirstRead = Promise.withResolvers<void>();
      let activeFile = "old.js";
      let manifestReads = 0;
      const manifestPath = "/project/dist/_veryfront/manifest.json";
      const repo = {
        readFile: async (path: string) => {
          if (toMockAbsolutePath(path) !== manifestPath) {
            throw createFsError("not found", "ENOENT");
          }
          const fileSnapshot = activeFile;
          manifestReads++;
          if (manifestReads === 1) {
            firstReadStarted.resolve();
            await releaseFirstRead.promise;
          }
          return JSON.stringify({
            chunks: { chunks: { main: { file: fileSnapshot } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: async (path: string) => new TextEncoder().encode(toMockAbsolutePath(path)),
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (
            absolutePath === manifestPath ||
            absolutePath === "/project/dist/_veryfront/old.js" ||
            absolutePath === "/project/dist/_veryfront/new.js"
          ) {
            return { isFile: true, isDirectory: false, mtime: new Date(1) };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const cacheOptions = makeOptions({ manifestCacheIdentity: "release-current" });

      const oldResultPromise = service.resolveFile("/_veryfront/old.js", cacheOptions);
      await firstReadStarted.promise;
      StaticFileService.clearCache();
      activeFile = "new.js";
      const newResult = await service.resolveFile("/_veryfront/new.js", cacheOptions);
      releaseFirstRead.resolve();
      await oldResultPromise;

      assertEquals(newResult?.source, "manifest");
      assertEquals(manifestReads, 2);
      assertEquals(manifestLoading.size, 0);
      assertEquals(manifestCache.size, 1);
      const activeIndex = [...manifestCache.values()][0] as {
        assets: Map<string, string>;
      };
      assertEquals(activeIndex.assets.has("/_veryfront/new.js"), true);
      assertEquals(activeIndex.assets.has("/_veryfront/old.js"), false);
    });

    it("retries a changed manifest generation without resolving its stale asset", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({ manifestCache, manifestLoading });
      let manifestReads = 0;
      let manifestStats = 0;
      const manifestPath = "/project/dist/_veryfront/manifest.json";
      const repo = {
        readFile: async (path: string) => {
          if (toMockAbsolutePath(path) !== manifestPath) {
            throw createFsError("not found", "ENOENT");
          }
          manifestReads++;
          const file = manifestReads === 1 ? "old.js" : "new.js";
          return JSON.stringify({
            chunks: { chunks: { main: { file } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: async (path: string) => new TextEncoder().encode(toMockAbsolutePath(path)),
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (absolutePath === manifestPath) {
            manifestStats++;
            return {
              isFile: true,
              isDirectory: false,
              mtime: new Date(manifestStats === 1 ? 1 : 2),
              size: 100,
            };
          }
          if (
            absolutePath === "/project/dist/_veryfront/old.js" ||
            absolutePath === "/project/dist/_veryfront/new.js"
          ) {
            return { isFile: true, isDirectory: false, mtime: new Date(2) };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions({ manifestCacheIdentity: "release-current" });

      const first = await resolveManifestAssetForTest(
        service,
        "/_veryfront/old.js",
        options,
        repo,
      );
      assertEquals(first, null);
      assertEquals(manifestReads, 2);
      assertEquals(manifestStats, 4);
      assertEquals(manifestCache.size, 1);

      const second = await resolveManifestAssetForTest(
        service,
        "/_veryfront/new.js",
        options,
        repo,
      );
      assertEquals(second, "dist/_veryfront/new.js");
      assertEquals(manifestReads, 2);
      assertEquals(manifestStats, 5);
      assertEquals(manifestCache.size, 1);
      const activeIndex = [...manifestCache.values()][0] as {
        assets: Map<string, string>;
        mtime: number | null;
      };
      assertEquals(activeIndex.mtime, 2);
      assertEquals(activeIndex.assets.has("/_veryfront/new.js"), true);
      assertEquals(activeIndex.assets.has("/_veryfront/old.js"), false);
    });

    it("fails after bounded retries when the manifest never has one stable generation", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({ manifestCache, manifestLoading });
      let manifestReads = 0;
      let manifestStats = 0;
      const repo = {
        readFile: () => {
          manifestReads++;
          return Promise.resolve(JSON.stringify({
            chunks: { chunks: { main: { file: "unstable.js" } }, shared: [] },
            routes: [],
          }));
        },
        readFileBytes: () => Promise.resolve(new Uint8Array()),
        stat: () => {
          manifestStats++;
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(manifestStats),
            size: 100,
          });
        },
      } as unknown as FileSystemRepository;

      await assertRejects(
        () =>
          resolveManifestAssetForTest(
            new StaticFileService(repo),
            "/_veryfront/unstable.js",
            makeOptions(),
            repo,
          ),
        Error,
        "changed while being read after 2 attempts",
      );

      assertEquals(manifestReads, 2);
      assertEquals(manifestStats, 4);
      assertEquals(manifestCache.size, 0);
      assertEquals(manifestLoading.size, 0);
    });

    it("does not coalesce same-size manifest loads when mtime is unavailable", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({ manifestCache, manifestLoading });
      const firstReadStarted = Promise.withResolvers<void>();
      const releaseFirstRead = Promise.withResolvers<void>();
      let activeFile = "old.js";
      let manifestReads = 0;
      const repo = {
        readFile: async () => {
          const file = activeFile;
          manifestReads++;
          if (manifestReads === 1) {
            firstReadStarted.resolve();
            await releaseFirstRead.promise;
          }
          return JSON.stringify({
            chunks: { chunks: { main: { file } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: () => Promise.resolve(new Uint8Array()),
        stat: () =>
          Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: null,
            size: 100,
          }),
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions({ manifestCacheIdentity: "release-current" });

      const firstResult = resolveManifestAssetForTest(
        service,
        "/_veryfront/old.js",
        options,
        repo,
      );
      await firstReadStarted.promise;
      activeFile = "new.js";
      const secondResult = resolveManifestAssetForTest(
        service,
        "/_veryfront/new.js",
        options,
        repo,
      );
      await Promise.resolve();
      await Promise.resolve();
      const readsBeforeFirstRelease = manifestReads;
      releaseFirstRead.resolve();

      assertEquals(await firstResult, "dist/_veryfront/old.js");
      assertEquals(await secondResult, "dist/_veryfront/new.js");
      assertEquals(readsBeforeFirstRelease, 2);
      assertEquals(manifestReads, 2);
      assertEquals(manifestCache.size, 0);
      assertEquals(manifestLoading.size, 0);
    });

    it("rejects a manifest whose UTF-8 source exceeds the byte limit", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
        manifestAdmissionLimits: { maxBytes: 64 },
      });
      const oversizedManifest = JSON.stringify({
        chunks: null,
        routes: [],
        padding: "x".repeat(128),
      });
      const repo = {
        readFile: () => Promise.resolve(oversizedManifest),
        readFileBytes: () => Promise.resolve(new Uint8Array()),
        stat: () =>
          Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(1),
          }),
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        RangeError,
        "Static build manifest byte limit of 64 was exceeded",
      );
    });

    it("rejects a manifest that exceeds its total asset-entry budget", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
        manifestAdmissionLimits: { maxAssetEntries: 2 },
      });
      const manifest = JSON.stringify({
        chunks: {
          chunks: {
            main: {
              file: "app.js",
              imports: ["first.js", "second.js"],
            },
          },
          shared: [],
        },
        routes: [],
      });
      const repo = createMockFsRepo(
        new Map([
          [
            "/project/dist/_veryfront/manifest.json",
            new TextEncoder().encode(manifest),
          ],
        ]),
      );

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        RangeError,
        "Static build manifest asset-entry limit of 2 was exceeded",
      );
    });

    it("rejects overlong manifest asset paths", async () => {
      const manifest = JSON.stringify({
        chunks: {
          chunks: {
            main: { file: `${"a".repeat(2_049)}.js` },
          },
          shared: [],
        },
        routes: [],
      });
      const repo = createMockFsRepo(
        new Map([
          [
            "/project/dist/_veryfront/manifest.json",
            new TextEncoder().encode(manifest),
          ],
        ]),
      );

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        TypeError,
        "bounded safe relative asset path",
      );
    });

    it("rejects accessor-backed manifest schema fields without invoking them", async () => {
      let accessorInvoked = false;
      const hostileManifest = Object.create(null);
      Object.defineProperty(hostileManifest, "chunks", {
        enumerable: true,
        get: () => {
          accessorInvoked = true;
          return null;
        },
      });
      Object.defineProperty(hostileManifest, "routes", {
        enumerable: true,
        value: [],
      });
      const service = new StaticFileService();

      await assertRejects(
        () =>
          Promise.resolve().then(() =>
            (service as unknown as {
              extractManifestAssets(value: unknown): Map<string, string>;
            }).extractManifestAssets(hostileManifest)
          ),
        TypeError,
        "must be an own data property",
      );
      assertEquals(accessorInvoked, false);
    });

    it("rejects proxy-backed manifest stat values without invoking their traps", async () => {
      let trapCalls = 0;
      const hostileStat = new Proxy(
        { isFile: true, mtime: new Date(1) },
        {
          getOwnPropertyDescriptor: (target, key) => {
            trapCalls++;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          getPrototypeOf: (target) => {
            trapCalls++;
            return Reflect.getPrototypeOf(target);
          },
          ownKeys: (target) => {
            trapCalls++;
            return Reflect.ownKeys(target);
          },
        },
      );
      const repo = {
        readFile: () => Promise.resolve('{"chunks":null,"routes":[]}'),
        readFileBytes: () => Promise.resolve(new Uint8Array()),
        stat: () => Promise.resolve(hostileStat),
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        TypeError,
        "proxies are not supported",
      );
      assertEquals(trapCalls, 0);
    });

    it("rejects manifest arrays with non-index properties", async () => {
      const shared: unknown[] & { metadata?: string } = [];
      shared.metadata = "not manifest data";
      const service = new StaticFileService();

      await assertRejects(
        () =>
          Promise.resolve().then(() =>
            (service as unknown as {
              extractManifestAssets(value: unknown): Map<string, string>;
            }).extractManifestAssets({
              chunks: { chunks: {}, shared },
              routes: [],
            })
          ),
        TypeError,
        "must be dense and contain no extra properties",
      );
    });

    it("rejects a non-finite manifest mtime before reading manifest content", async () => {
      let manifestReads = 0;
      const repo = {
        readFile: () => {
          manifestReads++;
          return Promise.resolve('{"chunks":null,"routes":[]}');
        },
        readFileBytes: () => Promise.resolve(new Uint8Array()),
        stat: () =>
          Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(Number.NaN),
          }),
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        RangeError,
        "Static build manifest mtime must be finite",
      );
      assertEquals(manifestReads, 0);
    });
  });

  describe("static asset byte admission", () => {
    function createAssetRepository(
      data: Uint8Array,
      declaredSize: number | null | undefined,
      overrides: {
        readFileBytes?: () => Promise<Uint8Array>;
        readFileBytesBounded?: (path: string, byteLimit: number) => Promise<Uint8Array>;
      } = {},
    ): FileSystemRepository {
      return {
        readFile: () => Promise.resolve(""),
        readFileBytes: overrides.readFileBytes ?? (() => Promise.resolve(data)),
        ...(overrides.readFileBytesBounded
          ? { readFileBytesBounded: overrides.readFileBytesBounded }
          : {}),
        stat: (path: string) => {
          if (toMockAbsolutePath(path) !== "/project/public/asset.bin") {
            return Promise.reject(createFsError("not found", "ENOENT"));
          }
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            mtime: new Date(1),
            ...(declaredSize === undefined ? {} : { size: declaredSize }),
          });
        },
      } as unknown as FileSystemRepository;
    }

    it("serves an asset exactly at the configured byte boundary", async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const repo = createAssetRepository(data, data.byteLength);
      const result = await new StaticFileService(repo, { maxAssetBytes: 4 }).resolveFile(
        "/asset.bin",
        makeOptions({ isLocalProject: true }),
      );

      assertExists(result);
      assertEquals(result.data, data);
    });

    it("rejects a declared oversized asset before reading bytes", async () => {
      let reads = 0;
      const repo = createAssetRepository(new Uint8Array(5), 5, {
        readFileBytes: () => {
          reads++;
          return Promise.resolve(new Uint8Array(5));
        },
      });

      await assertRejects(
        () =>
          new StaticFileService(repo, { maxAssetBytes: 4 }).resolveFile(
            "/asset.bin",
            makeOptions({ isLocalProject: true }),
          ),
        RangeError,
        "Static asset byte limit of 4 was exceeded",
      );
      assertEquals(reads, 0);
    });

    it("rejects oversized bytes when stat understates the asset size", async () => {
      const repo = createAssetRepository(new Uint8Array(5), 1);

      await assertRejects(
        () =>
          new StaticFileService(repo, { maxAssetBytes: 4 }).resolveFile(
            "/asset.bin",
            makeOptions({ isLocalProject: true }),
          ),
        RangeError,
        "Static asset byte limit of 4 was exceeded",
      );
    });

    it("uses a bounded reader for missing-size assets and validates its result", async () => {
      let requestedLimit = 0;
      let wholeReads = 0;
      const repo = createAssetRepository(new Uint8Array(5), undefined, {
        readFileBytes: () => {
          wholeReads++;
          return Promise.resolve(new Uint8Array(5));
        },
        readFileBytesBounded: (_path, byteLimit) => {
          requestedLimit = byteLimit;
          return Promise.resolve(new Uint8Array(5));
        },
      });

      await assertRejects(
        () =>
          new StaticFileService(repo, { maxAssetBytes: 4 }).resolveFile(
            "/asset.bin",
            makeOptions({ isLocalProject: true }),
          ),
        RangeError,
        "Static asset byte limit of 4 was exceeded",
      );
      assertEquals(requestedLimit, 5);
      assertEquals(wholeReads, 0);
    });

    it("rejects unsafe declared asset sizes without reading bytes", async () => {
      for (const declaredSize of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        let reads = 0;
        const repo = createAssetRepository(new Uint8Array(), declaredSize, {
          readFileBytes: () => {
            reads++;
            return Promise.resolve(new Uint8Array());
          },
        });

        await assertRejects(
          () =>
            new StaticFileService(repo, { maxAssetBytes: 4 }).resolveFile(
              "/asset.bin",
              makeOptions({ isLocalProject: true }),
            ),
          RangeError,
          "Static asset size must be a non-negative safe integer",
        );
        assertEquals(reads, 0);
      }
    });
  });

  describe("resolveFile", () => {
    it("resolves public assets through the real Deno adapter and returns an absolute path", async () => {
      await withTempProject(async (projectDir) => {
        const assetPath = `${projectDir}/public/logo.svg`;
        await Deno.mkdir(`${projectDir}/public`);
        await Deno.writeTextFile(assetPath, "<svg>public</svg>");

        const result = await new StaticFileService().resolveFile(
          "/logo.svg",
          makeOptions({
            projectDir,
            adapter: denoAdapter,
            isLocalProject: true,
          }),
        );

        assertExists(result);
        assertEquals(result.path, assetPath);
        assertEquals(result.source, "public");
        assertEquals(new TextDecoder().decode(result.data), "<svg>public</svg>");
      });
    });

    it("resolves dist assets through the real Deno adapter and returns an absolute path", async () => {
      await withTempProject(async (projectDir) => {
        const assetPath = `${projectDir}/dist/app.js`;
        await Deno.mkdir(`${projectDir}/dist`);
        await Deno.writeTextFile(assetPath, "export const built = true;");

        const result = await new StaticFileService().resolveFile(
          "/app.js",
          makeOptions({ projectDir, adapter: denoAdapter }),
        );

        assertExists(result);
        assertEquals(result.path, assetPath);
        assertEquals(result.source, "dist");
        assertEquals(new TextDecoder().decode(result.data), "export const built = true;");
      });
    });

    it("returns null for a real missing Deno filesystem candidate", async () => {
      await withTempProject(async (projectDir) => {
        await Deno.mkdir(`${projectDir}/public`);

        const result = await new StaticFileService().resolveFile(
          "/missing.txt",
          makeOptions({
            projectDir,
            adapter: denoAdapter,
            isLocalProject: true,
          }),
        );

        assertEquals(result, null);
      });
    });

    it("propagates real Deno adapter traversal rejections", async () => {
      await withTempProject(async (projectDir) => {
        await Deno.mkdir(`${projectDir}/public`);
        await Deno.writeTextFile(`${projectDir}/secret.txt`, "not public");

        const error = await assertRejects(
          () =>
            new StaticFileService().resolveFile(
              "/../secret.txt",
              makeOptions({
                projectDir,
                adapter: denoAdapter,
                isLocalProject: true,
              }),
            ),
          Error,
        );

        assertEquals((error as { slug?: string }).slug, "security-violation");
      });
    });

    it("rejects traversal from an allowed public root into dist", async () => {
      await withTempProject(async (projectDir) => {
        await Deno.mkdir(`${projectDir}/public`);
        await Deno.mkdir(`${projectDir}/dist`);
        await Deno.writeTextFile(`${projectDir}/dist/secret.txt`, "stale build");

        const error = await assertRejects(
          () =>
            new StaticFileService().resolveFile(
              "/../dist/secret.txt",
              makeOptions({
                projectDir,
                adapter: denoAdapter,
                isLocalProject: true,
              }),
            ),
          Error,
        );

        assertEquals((error as { slug?: string }).slug, "security-violation");
      });
    });

    it("should return null when file does not exist", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const service = new StaticFileService(createMockFsRepo(new Map()));
      const options = makeOptions();
      const result = await service.resolveFile("/nonexistent.txt", options);
      assertEquals(result, null);
    });

    it("should resolve file from injected FileSystemRepository", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("hello world");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/test.txt", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions();

      const result = await service.resolveFile("/test.txt", options);
      if (result) {
        assertEquals(result.source, "dist");
        assertEquals(result.contentType.includes("text/plain"), true);
        assertEquals(result.data, fileData);
        assertEquals(typeof result.etag, "string");
      }
    });

    it("should resolve file from public directory", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<svg></svg>");
      const files = new Map<string, Uint8Array>([
        ["/project/public/logo.svg", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions();

      const result = await service.resolveFile("/logo.svg", options);
      if (result) {
        assertEquals(result.source, "public");
      }
    });

    it("propagates operational errors without probing a sibling candidate", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("public fallback");
      const repo = {
        readFile: async () => "",
        readFileBytes: async (path: string) => {
          if (toMockAbsolutePath(path) === "/project/dist/app.js") {
            throw createFsError("temporary read failure", "EIO");
          }
          return fileData;
        },
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (
            absolutePath === "/project/dist/app.js" ||
            absolutePath === "/project/public/app.js"
          ) {
            return { isFile: true, isDirectory: false, mtime: new Date() };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions();

      await assertRejects(
        () => service.resolveFile("/app.js", options),
        Error,
        "temporary read failure",
      );
    });

    it("surfaces unexpected candidate errors when no sibling candidate resolves", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const repo = {
        readFile: async () => "",
        readFileBytes: async () => {
          throw createFsError("temporary read failure", "EIO");
        },
        stat: async (path: string) => {
          if (toMockAbsolutePath(path) === "/project/dist/app.js") {
            return { isFile: true, isDirectory: false, mtime: new Date() };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions();

      await assertRejects(
        () => service.resolveFile("/app.js", options),
        Error,
        "temporary read failure",
      );
    });

    it("propagates security validation candidate rejections", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const repo = {
        readFile: async () => "",
        readFileBytes: async () => new Uint8Array(),
        stat: async () => {
          throw SECURITY_VIOLATION.create({ detail: "Invalid path" });
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions({ isLocalProject: true });

      const error = await assertRejects(
        () => service.resolveFile("/app.js", options),
        Error,
      );
      assertEquals((error as { slug?: string }).slug, "security-violation");
    });

    it("propagates operational manifest stat errors before serving a fallback", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("fallback");
      const repo = {
        readFile: async () => "",
        readFileBytes: async () => fileData,
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (absolutePath === "/project/dist/_veryfront/manifest.json") {
            throw createFsError("manifest storage unavailable", "EIO");
          }
          if (absolutePath === "/project/dist/app.js") {
            return { isFile: true, isDirectory: false, mtime: new Date() };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        Error,
        "manifest storage unavailable",
      );
    });

    it("propagates operational manifest read errors before serving a fallback", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("fallback");
      const repo = {
        readFile: async (path: string) => {
          if (toMockAbsolutePath(path) === "/project/dist/_veryfront/manifest.json") {
            throw createFsError("manifest read failed", "EIO");
          }
          return "";
        },
        readFileBytes: async () => fileData,
        stat: async (path: string) => {
          const absolutePath = toMockAbsolutePath(path);
          if (
            absolutePath === "/project/dist/_veryfront/manifest.json" ||
            absolutePath === "/project/dist/app.js"
          ) {
            return { isFile: true, isDirectory: false, mtime: new Date() };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        Error,
        "manifest read failed",
      );
    });

    it("should ignore generated dist files for local projects", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>stale build</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/index.html", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isLocalProject: true });

      const result = await service.resolveFile("/", options);
      assertEquals(result, null);
    });

    it("should ignore explicit dist index requests for local projects", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>stale build</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/index.html", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isLocalProject: true });

      const result = await service.resolveFile("/index.html", options);
      assertEquals(result, null);
    });

    it("should normalize / to /index.html", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html></html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/index.html", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions();

      const result = await service.resolveFile("/", options);
      if (result) {
        assertEquals(result.contentType.includes("html"), true);
      }
    });

    it("does not serve stale dist HTML for local dev projects", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>stale build</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/index.html", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isLocalProject: true, isPreviewMode: false });

      const result = await service.resolveFile("/", options);
      assertEquals(result, null);
    });

    it("still serves dist HTML outside local dev", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>built app</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/index.html", fileData],
      ]);
      const repo = createMockFsRepo(files);
      const service = new StaticFileService(repo);
      const options = makeOptions({ isLocalProject: false, isPreviewMode: false });

      const result = await service.resolveFile("/", options);
      assertEquals(result?.source, "dist");
      assertEquals(result?.data, fileData);
    });
  });
});
