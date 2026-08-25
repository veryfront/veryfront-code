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

function createNativeFsAdapter(
  files: Map<string, Uint8Array>,
): StaticFileOptions["adapter"] {
  const ready = Promise.resolve();
  return {
    fs: {
      symlinkSemantics: "none" as const,
      readFile: async (path: string) => {
        const data = files.get(path);
        if (!data) throw createFsError("not found", "ENOENT");
        return new TextDecoder().decode(data);
      },
      readFileBytes: async (path: string) => {
        const data = files.get(path);
        if (!data) throw createFsError("not found", "ENOENT");
        return data;
      },
      writeFile: async () => {},
      exists: async (path: string) => files.has(path),
      stat: async (path: string) => {
        const data = files.get(path);
        if (!data) throw createFsError("not found", "ENOENT");
        return {
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: data.byteLength,
          mtime: new Date(0),
        };
      },
      async *readDir() {},
      mkdir: async () => {},
      remove: async () => {},
      makeTempDir: async (prefix: string) => `/tmp/${prefix}`,
      watch: () => ({
        ready,
        done: ready,
        close() {},
        async *[Symbol.asyncIterator]() {},
      }),
    },
  } as unknown as StaticFileOptions["adapter"];
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

    it("returns immutable for unhashed platform assets served from dist", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("runtime");
      const repo = createMockFsRepo(
        new Map([["/project/dist/_veryfront/runtime.js", fileData]]),
      );
      const service = new StaticFileService(repo);
      const options = makeOptions({ isPreviewMode: false, isLocalProject: false });

      const result = await service.resolveFile("/_veryfront/runtime.js", options);
      assertExists(result, "unhashed platform asset must resolve from dist");
      assertEquals(
        result.cacheStrategy,
        "immutable",
        "unhashed /_veryfront assets served from dist must stay immutable",
      );
    });

    it("returns medium for a project-supplied /_veryfront file from public", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("runtime");
      const repo = createMockFsRepo(
        new Map([["/project/public/_veryfront/runtime.js", fileData]]),
      );
      const service = new StaticFileService(repo);
      const options = makeOptions({ isPreviewMode: false, isLocalProject: false });

      const result = await service.resolveFile("/_veryfront/runtime.js", options);
      assertExists(result, "the public file must resolve");
      assertEquals(
        result.cacheStrategy,
        "medium",
        "a project-supplied /_veryfront file from public must not inherit immutable caching",
      );
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

    it("reloads the manifest index when manifest.json changes on disk", async () => {
      const buildManifest = (file: string) =>
        new TextEncoder().encode(
          JSON.stringify({
            chunks: { chunks: { main: { file } }, shared: [] },
            routes: [],
          }),
        );
      const fileData = new TextEncoder().encode("app code");
      const manifestPath = "/project/dist/_veryfront/manifest.json";
      const files = new Map<string, Uint8Array>([
        [manifestPath, buildManifest("old.js")],
        ["/project/dist/_veryfront/old.js", fileData],
        ["/project/dist/_veryfront/new.js", fileData],
      ]);
      let manifestMtime = 1_000;
      const repo = {
        readFile: async (path: string) => {
          const data = files.get(path);
          if (!data) throw createFsError("not found", "ENOENT");
          return new TextDecoder().decode(data);
        },
        readFileBytes: async (path: string) => {
          const data = files.get(path);
          if (!data) throw createFsError("not found", "ENOENT");
          return data;
        },
        stat: async (path: string) => {
          if (!files.has(path)) throw createFsError("not found", "ENOENT");
          return {
            isFile: true,
            isDirectory: false,
            mtime: new Date(path === manifestPath ? manifestMtime : 0),
          };
        },
      } as unknown as FileSystemRepository;

      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const service = new StaticFileService(repo);
      const options = makeOptions();

      const first = await service.resolveFile("/_veryfront/old.js", options);
      assertExists(first, "the initial manifest entry resolves");
      assertEquals(first.source, "manifest");

      files.set(manifestPath, buildManifest("new.js"));
      manifestMtime = 2_000;

      const updated = await service.resolveFile("/_veryfront/new.js", options);
      assertExists(updated, "a rebuilt manifest.json must invalidate the stale manifest index");
      assertEquals(
        updated.source,
        "manifest",
        "the new chunk must be served from the reloaded manifest index",
      );
      const stale = await service.resolveFile("/_veryfront/old.js", options);
      assertExists(stale, "the old chunk still exists on disk");
      assertEquals(
        stale.source,
        "dist",
        "the stale manifest entry must not survive a manifest.json rebuild",
      );
    });

    it("rejects manifest assets outside the configured build output", async () => {
      const manifest = {
        chunks: {
          chunks: { main: { file: "../../../src/private.js" } },
          shared: [],
        },
        routes: [],
      };
      const files = new Map<string, Uint8Array>([
        [
          "/project/dist/_veryfront/manifest.json",
          new TextEncoder().encode(JSON.stringify(manifest)),
        ],
        ["/project/src/private.js", new TextEncoder().encode("private source")],
      ]);
      __injectDepsForTests({ manifestCache: new Map(), manifestLoading: new Map() });

      const service = new StaticFileService(createMockFsRepo(files));
      assertEquals(await service.resolveFile("/_veryfront/private.js", makeOptions()), null);
    });
  });

  describe("resolveFile", () => {
    it("serves public files locally without validating an unused embedded output", async () => {
      const data = new TextEncoder().encode("public");
      const service = new StaticFileService(
        createMockFsRepo(new Map([["/project/public/hello.txt", data]])),
      );

      const result = await service.resolveFile(
        "/hello.txt",
        makeOptions({ isLocalProject: true, buildOutDir: "../host/dist" }),
      );

      assertEquals(result?.data, data);
      assertEquals(result?.source, "public");
    });
    it("serves project files through the scoped SecureFs boundary", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("hello world");
      const files = new Map<string, Uint8Array>([
        ["/project/public/hello.txt", fileData],
      ]);
      const ready = Promise.resolve();
      const adapter = {
        fs: {
          symlinkSemantics: "none" as const,
          readFile: async (path: string) => {
            const data = files.get(path);
            if (!data) throw createFsError("not found", "ENOENT");
            return new TextDecoder().decode(data);
          },
          readFileBytes: async (path: string) => {
            const data = files.get(path);
            if (!data) throw createFsError("not found", "ENOENT");
            return data;
          },
          writeFile: async () => {},
          exists: async (path: string) => files.has(path),
          stat: async (path: string) => {
            const data = files.get(path);
            if (!data) throw createFsError("not found", "ENOENT");
            return {
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: data.byteLength,
              mtime: new Date(0),
            };
          },
          async *readDir() {},
          mkdir: async () => {},
          remove: async () => {},
          makeTempDir: async (prefix: string) => `/tmp/${prefix}`,
          watch: () => ({
            ready,
            done: ready,
            close() {},
            async *[Symbol.asyncIterator]() {},
          }),
        },
      } as unknown as StaticFileOptions["adapter"];
      const service = new StaticFileService();
      const options = makeOptions({ adapter, isLocalProject: true });

      const result = await service.resolveFile("/hello.txt", options);

      assertExists(result);
      assertEquals(result.path, "/project/public/hello.txt");
      assertEquals(result.data, fileData);
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

    it("rejects parent-segment requests that escape the dist root via the repository", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const enc = (text: string) => new TextEncoder().encode(text);
      const repo = createMockFsRepo(
        new Map([
          ["/project/secret.txt", enc("secret")],
          ["/etc/passwd", enc("root:x")],
        ]),
      );
      const service = new StaticFileService(repo);

      assertEquals(
        await service.resolveFile("/../secret.txt", makeOptions()),
        null,
        "a parent-segment request must not escape the dist root",
      );
      assertEquals(
        await service.resolveFile("/../../etc/passwd", makeOptions()),
        null,
        "a doubled parent-segment request must not escape the project root",
      );
    });

    it("rejects parent-segment requests that escape the dist root via SecureFs", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const enc = (text: string) => new TextEncoder().encode(text);
      const adapter = createNativeFsAdapter(
        new Map([
          ["/project/secret.txt", enc("secret")],
          ["/etc/passwd", enc("root:x")],
        ]),
      );
      const service = new StaticFileService();

      assertEquals(
        await service.resolveFile("/../secret.txt", makeOptions({ adapter })),
        null,
        "a parent-segment request must not escape the dist root",
      );
      assertEquals(
        await service.resolveFile("/../../etc/passwd", makeOptions({ adapter })),
        null,
        "a doubled parent-segment request must not escape the project root",
      );
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

    it("serves production assets from the configured build output directory", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const runtimePath = "/_veryfront/hydration-runtime.2b3c4d5e.js";
      const fileData = new TextEncoder().encode("export const release = true;");
      const files = new Map<string, Uint8Array>([
        [`/project/custom-output${runtimePath}`, fileData],
      ]);
      const service = new StaticFileService(createMockFsRepo(files));
      const options = makeOptions({ buildOutDir: "custom-output" });

      const result = await service.resolveFile(runtimePath, options);

      assertExists(result);
      assertEquals(result.path, `/project/custom-output${runtimePath}`);
      assertEquals(result.source, "dist");
      assertEquals(result.data, fileData);
      assertEquals(result.cacheStrategy, "immutable");
    });

    it("does not serve files from a build output outside the project", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const runtimePath = "/passwd";
      const buildOutDir = "/etc";
      const files = new Map<string, Uint8Array>([
        ["/etc/passwd", new TextEncoder().encode("host data")],
      ]);
      const adapter = createNativeFsAdapter(files);
      const service = new StaticFileService();
      const options = makeOptions({ adapter, buildOutDir });

      await assertRejects(
        () => service.resolveFile(runtimePath, options),
        Error,
        "inside the project",
      );
      await assertRejects(
        () => service.resolveFile(runtimePath, makeOptions({ adapter, buildOutDir: "../etc" })),
        Error,
        "inside the project",
      );
    });

    it("does not widen source access when build output contains the project", async () => {
      const files = new Map<string, Uint8Array>([
        ["/project/src/private.js", new TextEncoder().encode("private source")],
      ]);
      const adapter = createNativeFsAdapter(files);
      const service = new StaticFileService();

      await assertRejects(
        () =>
          service.resolveFile(
            "/src/private.js",
            makeOptions({ adapter, buildOutDir: "." }),
          ),
        Error,
        "inside the project",
      );
    });

    it("serves built nested index pages through clean route URLs", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>About</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/about/index.html", fileData],
      ]);
      const service = new StaticFileService(createMockFsRepo(files));
      const options = makeOptions();

      for (const route of ["/about", "/about/"]) {
        const result = await service.resolveFile(route, options);

        assertExists(result);
        assertEquals(result.path, "/project/dist/about/index.html");
        assertEquals(result.contentType.includes("text/html"), true);
        assertEquals(result.data, fileData);
      }
    });

    it("serves built index pages when a clean route segment contains a dot", async () => {
      __injectDepsForTests({
        manifestCache: new Map(),
        manifestLoading: new Map(),
      });

      const fileData = new TextEncoder().encode("<html>Blog post</html>");
      const files = new Map<string, Uint8Array>([
        ["/project/dist/blog.post/index.html", fileData],
      ]);
      const service = new StaticFileService(createMockFsRepo(files));
      const options = makeOptions();

      for (const route of ["/blog.post", "/blog.post/"]) {
        const result = await service.resolveFile(route, options);

        assertExists(result);
        assertEquals(result.path, "/project/dist/blog.post/index.html");
        assertEquals(result.contentType.includes("text/html"), true);
        assertEquals(result.data, fileData);
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
