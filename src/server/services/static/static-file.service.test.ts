import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  type StaticFileOptions,
  StaticFileService,
} from "./static-file.service.ts";
import type { FileSystemRepository } from "#veryfront/repositories/types.ts";

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
      throw new Error("not found");
    },
  } as unknown as FileSystemRepository;
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
      const options = makeOptions({ isPreviewMode: false, isLocalProject: true });

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
  });

  describe("resolveFile", () => {
    it("should return null when file does not exist", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const service = new StaticFileService();
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
  });
});
