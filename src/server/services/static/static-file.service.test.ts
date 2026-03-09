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
