import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  MAX_STATIC_FILE_BYTES,
  MAX_STATIC_MANIFEST_BYTES,
  type StaticFileOptions,
  StaticFileService,
} from "./static-file.service.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors/error-registry.ts";

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
      const data = files.get(path);
      if (!data) throw new Error("not found");
      return new TextDecoder().decode(data);
    },
    readFileBytes: async (path: string) => {
      const data = files.get(path);
      if (!data) throw new Error("not found");
      return data;
    },
    stat: async (path: string) => {
      if (files.has(path)) {
        return { isFile: true, isDirectory: false, mtime: new Date() };
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
      if (result) {
        assertEquals(result.source, "manifest");
        assertEquals(result.data, fileData);
      }
    });

    it("isolates cached manifests for distinct filesystem sources at the same project path", async () => {
      const manifestCache = new Map();
      const manifestLoading = new Map();
      __injectDepsForTests({ manifestCache, manifestLoading });

      const createRepo = (chunk: string): FileSystemRepository => {
        const manifest = JSON.stringify({
          chunks: { chunks: { main: { file: chunk } }, shared: [] },
          routes: [],
        });
        const files = new Map<string, Uint8Array>([
          [
            "/project/dist/_veryfront/manifest.json",
            new TextEncoder().encode(manifest),
          ],
          [`/project/dist/_veryfront/${chunk}`, new TextEncoder().encode(chunk)],
        ]);
        return {
          ...createMockFsRepo(files),
          stat: async (path: string) => {
            if (files.has(path)) {
              return {
                isFile: true,
                isDirectory: false,
                isSymlink: false,
                size: files.get(path)!.byteLength,
                mtime: new Date(1_000),
              };
            }
            throw createFsError("not found", "ENOENT");
          },
        } as FileSystemRepository;
      };

      const first = await new StaticFileService(createRepo("first.js")).resolveFile(
        "/_veryfront/first.js",
        makeOptions(),
      );
      const second = await new StaticFileService(createRepo("second.js")).resolveFile(
        "/_veryfront/second.js",
        makeOptions(),
      );

      assertEquals(first?.source, "manifest");
      assertEquals(second?.source, "manifest");
    });

    it("reloads manifests when the filesystem cannot report an mtime", async () => {
      let manifestChunk = "first.js";
      let manifestReads = 0;
      const repo = {
        readFile: async (path: string) => {
          if (path !== "/project/dist/_veryfront/manifest.json") {
            throw createFsError("not found", "ENOENT");
          }
          manifestReads++;
          return JSON.stringify({
            chunks: { chunks: { main: { file: manifestChunk } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: async (path: string) => new TextEncoder().encode(path),
        stat: async (path: string) => {
          if (
            path === "/project/dist/_veryfront/manifest.json" ||
            path === `/project/dist/_veryfront/${manifestChunk}`
          ) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 1,
              mtime: null,
            };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      __injectDepsForTests({ manifestCache: new Map(), manifestLoading: new Map() });
      const service = new StaticFileService(repo);

      assertEquals(
        (await service.resolveFile("/_veryfront/first.js", makeOptions()))?.source,
        "manifest",
      );
      manifestChunk = "second.js";
      assertEquals(
        (await service.resolveFile("/_veryfront/second.js", makeOptions()))?.source,
        "manifest",
      );
      assertEquals(manifestReads, 2);
    });

    it("does not let a manifest load repopulate the cache after clearCache", async () => {
      StaticFileService.clearCache();
      let markReadEntered: (() => void) | undefined;
      const readEntered = new Promise<void>((resolve) => {
        markReadEntered = resolve;
      });
      let releaseRead: (() => void) | undefined;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let manifestChunk = "first.js";
      let firstRead = true;
      const repo = {
        readFile: async () => {
          const chunkAtReadStart = manifestChunk;
          if (firstRead) {
            firstRead = false;
            markReadEntered?.();
            await readGate;
          }
          return JSON.stringify({
            chunks: { chunks: { main: { file: chunkAtReadStart } }, shared: [] },
            routes: [],
          });
        },
        readFileBytes: async (path: string) => new TextEncoder().encode(path),
        stat: async (path: string) => {
          if (
            path === "/project/dist/_veryfront/manifest.json" ||
            path.endsWith("/first.js") || path.endsWith("/second.js")
          ) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 1,
              mtime: new Date(1_000),
            };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);

      const firstResolution = service.resolveFile("/_veryfront/first.js", makeOptions());
      await readEntered;
      StaticFileService.clearCache();
      manifestChunk = "second.js";
      releaseRead?.();
      await firstResolution;

      assertEquals(
        (await service.resolveFile("/_veryfront/second.js", makeOptions()))?.source,
        "manifest",
      );
      StaticFileService.clearCache();
    });

    it("surfaces unreadable manifests instead of falling through to direct assets", async () => {
      const repo = {
        readFile: async () => {
          throw createFsError("manifest read failed", "EIO");
        },
        readFileBytes: async () => new TextEncoder().encode("fallback"),
        stat: async (path: string) => {
          if (
            path === "/project/dist/_veryfront/manifest.json" ||
            path === "/project/dist/app.js"
          ) {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 10,
              mtime: new Date(),
            };
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

    it("surfaces malformed manifests with a sanitized error", async () => {
      const files = new Map<string, Uint8Array>([
        [
          "/project/dist/_veryfront/manifest.json",
          new TextEncoder().encode('{"chunks":'),
        ],
        ["/project/dist/app.js", new TextEncoder().encode("fallback")],
      ]);
      const repo = createMockFsRepo(files);

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        TypeError,
        "Static build manifest is invalid",
      );
    });

    it("rejects oversized manifests before reading them", async () => {
      let manifestReads = 0;
      const repo = {
        readFile: async () => {
          manifestReads++;
          return "{}";
        },
        readFileBytes: async () => new Uint8Array(),
        stat: async (path: string) => {
          if (path === "/project/dist/_veryfront/manifest.json") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: MAX_STATIC_MANIFEST_BYTES + 1,
              mtime: new Date(),
            };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;

      await assertRejects(
        () => new StaticFileService(repo).resolveFile("/app.js", makeOptions()),
        RangeError,
        "Static build manifest exceeds",
      );
      assertEquals(manifestReads, 0);
    });
  });

  describe("resolveFile", () => {
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

    it("rejects oversized files before reading their bodies", async () => {
      let bodyReads = 0;
      const repo = {
        readFile: async () => {
          throw createFsError("not found", "ENOENT");
        },
        readFileBytes: async () => {
          bodyReads++;
          return new Uint8Array();
        },
        stat: async (path: string) => {
          if (path === "/project/dist/large.bin") {
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: MAX_STATIC_FILE_BYTES + 1,
              mtime: new Date(),
            };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);

      await assertRejects(
        () => service.resolveFile("/large.bin", makeOptions()),
        RangeError,
        "Static file exceeds",
      );
      assertEquals(bodyReads, 0);
    });

    it("continues probing sibling candidates after an unexpected candidate error", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("public fallback");
      const repo = {
        readFile: async () => "",
        readFileBytes: async (path: string) => {
          if (path === "/project/dist/app.js") {
            throw createFsError("temporary read failure", "EIO");
          }
          return fileData;
        },
        stat: async (path: string) => {
          if (path === "/project/dist/app.js" || path === "/project/public/app.js") {
            return { isFile: true, isDirectory: false, mtime: new Date() };
          }
          throw createFsError("not found", "ENOENT");
        },
      } as unknown as FileSystemRepository;
      const service = new StaticFileService(repo);
      const options = makeOptions();

      const result = await service.resolveFile("/app.js", options);
      assertExists(result);
      assertEquals(result.source, "public");
      assertEquals(new TextDecoder().decode(result.data), "public fallback");
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
          if (path === "/project/dist/app.js") {
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

    it("treats security validation candidate rejection as a candidate miss", async () => {
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
      const options = makeOptions();

      const result = await service.resolveFile("/app.js", options);
      assertEquals(result, null);
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
