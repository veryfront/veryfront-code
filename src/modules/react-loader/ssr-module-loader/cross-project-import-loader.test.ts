import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import { buildSSRModuleCacheKey } from "#veryfront/cache/keys.ts";
import { globalCrossProjectCache, globalCrossProjectInProgress } from "./cache/index.ts";
import { transformCrossProjectImportFlow } from "./cross-project-import-loader.ts";

function createMockCacheFs(overrides: Partial<FileSystem> = {}): FileSystem {
  return {
    readTextFile: () => Promise.resolve(""),
    readFile: () => Promise.resolve(new Uint8Array()),
    writeTextFile: () => Promise.resolve(),
    writeFile: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    stat: () =>
      Promise.resolve({
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 100,
        mtime: null,
      }),
    mkdir: () => Promise.resolve(),
    readDir: () => (async function* () {})(),
    remove: () => Promise.resolve(),
    makeTempDir: () => Promise.resolve("/tmp/test"),
    chmod: () => Promise.resolve(),
    ...overrides,
  } as FileSystem;
}

const crossProjectImport: CrossProjectImport = {
  specifier: "@acme-ui@1.2.3/@/components/Button.tsx",
  projectSlug: "acme-ui",
  version: "1.2.3",
  path: "components/Button.tsx",
};

describe("modules/react-loader/ssr-module-loader/cross-project-import-loader", () => {
  it("returns cached temp path without fetching", async () => {
    globalCrossProjectCache.clear();
    const cacheKey = buildSSRModuleCacheKey(
      "cross-project-default-development",
      "project-a",
      JSON.stringify([
        "https://registry.example.com",
        crossProjectImport.projectSlug,
        crossProjectImport.version,
        crossProjectImport.path,
      ]),
    );
    globalCrossProjectCache.set(cacheKey, {
      tempPath: "/tmp/cached-cross-project.mjs",
      contentHash: "cafe1234",
    });

    let fetchCalls = 0;
    let capacityCalls = 0;

    const result = await transformCrossProjectImportFlow({
      crossProjectImport,
      options: {
        projectId: "project-a",
        projectDir: "/project",
        dev: true,
        apiBaseUrl: "https://registry.example.com/api",
        adapter: denoAdapter,
      },
      cache: {
        hashContentAsync: async () => "unused",
        getTempPath: async () => "/tmp/unused.mjs",
        getFs: () => createMockCacheFs(),
      },
      withTransformCapacity: async <T>(
        _syntheticFilePath: string,
        _operation: () => Promise<T>,
      ): Promise<T> => {
        capacityCalls++;
        throw new Error("unexpected withTransformCapacity call on cache hit");
      },
      fetchImpl: async () => {
        fetchCalls++;
        return new Response("unused");
      },
    });

    assertEquals(result, "/tmp/cached-cross-project.mjs");
    assertEquals(fetchCalls, 0);
    assertEquals(capacityCalls, 0);
  });

  it("fetches, transforms, writes temp file, and caches transformed cross-project import", async () => {
    globalCrossProjectCache.clear();

    let fetchedUrl = "";
    let fetchedHeaders: Headers | undefined;
    let injectedContextCount = 0;
    let capacityPath = "";
    let transformedFilePath = "";
    let mkdirPath = "";
    let writePath = "";
    let writeCode = "";
    const debugLogs: string[] = [];

    const result = await transformCrossProjectImportFlow({
      crossProjectImport,
      options: {
        projectId: "project-a",
        projectDir: "/project",
        dev: true,
        apiBaseUrl: "https://registry.example.com/api",
        reactVersion: "19.1.1",
        adapter: denoAdapter,
      },
      cache: {
        hashContentAsync: async (content: string) => {
          assertEquals(content, "export const remoteValue = 1;");
          return "1234abcd";
        },
        getTempPath: async (_filePath: string, contentHash?: string) => {
          assertEquals(contentHash, "1234abcd");
          return "/tmp/cross-project-transformed.mjs";
        },
        getFs: () =>
          createMockCacheFs({
            mkdir: async (path: string) => {
              mkdirPath = path;
            },
            writeTextFile: async (path: string, data: string) => {
              writePath = path;
              writeCode = data;
            },
          }),
      },
      withTransformCapacity: async (syntheticFilePath, operation) => {
        capacityPath = syntheticFilePath;
        return await operation();
      },
      fetchImpl: async (input, init) => {
        fetchedUrl = String(input);
        fetchedHeaders = (init as { headers?: Headers } | undefined)?.headers;
        return new Response("export const remoteValue = 1;", { status: 200 });
      },
      injectContextImpl: (headers) => {
        injectedContextCount++;
        headers.set("x-trace-id", "trace-123");
      },
      transformToESMImpl: async (_source, filePathWithExt) => {
        transformedFilePath = filePathWithExt;
        return "export const transformed = true;";
      },
      loggerImpl: {
        debug: (message) => {
          debugLogs.push(message);
        },
        error: () => {},
      },
    });

    const expectedRegistryUrl =
      "https://registry.example.com/acme-ui@1.2.3/@/components/Button.tsx";
    const expectedCacheKey = buildSSRModuleCacheKey(
      "cross-project-19.1.1-development",
      "project-a",
      JSON.stringify([
        "https://registry.example.com",
        crossProjectImport.projectSlug,
        crossProjectImport.version,
        crossProjectImport.path,
      ]),
    );

    assertEquals(result, "/tmp/cross-project-transformed.mjs");
    assertEquals(fetchedUrl, expectedRegistryUrl);
    assertEquals(fetchedHeaders?.get("Accept"), "text/plain, application/javascript, */*");
    assertEquals(fetchedHeaders?.get("x-trace-id"), "trace-123");
    assertEquals(injectedContextCount, 1);
    assertEquals(capacityPath, "cross-project/acme-ui@1.2.3/@/components/Button.tsx");
    assertEquals(transformedFilePath, "cross-project/acme-ui@1.2.3/@/components/Button.tsx");
    assertEquals(mkdirPath, "/tmp");
    assertEquals(writePath, "/tmp/cross-project-transformed.mjs");
    assertEquals(writeCode, "export const transformed = true;");

    const cached = globalCrossProjectCache.get(expectedCacheKey);
    assert(!!cached);
    assertEquals(cached?.tempPath, "/tmp/cross-project-transformed.mjs");
    assertEquals(cached?.contentHash, "1234abcd");
    assertEquals(debugLogs.includes("[SSR-MODULE-LOADER] Fetching cross-project import"), true);
    assertEquals(debugLogs.includes("[SSR-MODULE-LOADER] Cross-project import transformed"), true);
  });

  it("rejects source bodies whose UTF-8 byte size exceeds the fallback limit before transform", async () => {
    globalCrossProjectCache.clear();

    let transformed = false;
    const oversizedUtf8Source = "é".repeat(3_000_000);

    await assertRejects(
      () =>
        transformCrossProjectImportFlow({
          crossProjectImport,
          options: {
            projectId: "project-a",
            projectDir: "/project",
            dev: true,
            apiBaseUrl: "https://registry.example.com/api",
            adapter: denoAdapter,
          },
          cache: {
            hashContentAsync: async () => "unused",
            getTempPath: async () => "/tmp/unused.mjs",
            getFs: () => createMockCacheFs(),
          },
          withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
          fetchImpl: async () => new Response(oversizedUtf8Source, { status: 200 }),
          transformToESMImpl: async () => {
            transformed = true;
            return "";
          },
          loggerImpl: { debug: () => {}, error: () => {} },
        }),
      Error,
      "Cross-project source exceeds size limit",
    );

    assertEquals(transformed, false);
  });

  it("returns a sanitized request error and logs only safe failure context", async () => {
    globalCrossProjectCache.clear();

    let errorLogMessage = "";
    let errorLogContext: unknown;

    await assertRejects(
      () =>
        transformCrossProjectImportFlow({
          crossProjectImport,
          options: {
            projectId: "project-a",
            projectDir: "/project",
            dev: true,
            apiBaseUrl: "https://registry.example.com/api",
            adapter: denoAdapter,
          },
          cache: {
            hashContentAsync: async () => "unused",
            getTempPath: async () => "/tmp/unused.mjs",
            getFs: () => createMockCacheFs(),
          },
          withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
          fetchImpl: async () =>
            new Response("not found", { status: 404, statusText: "Not Found" }),
          loggerImpl: {
            debug: () => {},
            error: (message, context) => {
              errorLogMessage = message;
              errorLogContext = context;
            },
          },
        }),
      Error,
      "Cross-project module request failed with status 404",
    );

    assertEquals(errorLogMessage, "[SSR-MODULE-LOADER] Failed to load cross-project import");
    const context = errorLogContext as Record<string, unknown> | undefined;
    assertEquals(context, { errorName: "VeryfrontError" });
  });

  it("coalesces concurrent transforms for the same project module", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();

    let fetchCalls = 0;
    let transformCalls = 0;
    let releaseFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const flow = () =>
      transformCrossProjectImportFlow({
        crossProjectImport,
        options: {
          projectId: "project-a",
          projectDir: "/project",
          dev: true,
          apiBaseUrl: "https://registry.example.com/api",
          adapter: denoAdapter,
        },
        cache: {
          hashContentAsync: async () => "1234abcd",
          getTempPath: async () => "/tmp/coalesced.mjs",
          getFs: () => createMockCacheFs(),
        },
        withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
        fetchImpl: async () => {
          fetchCalls++;
          await fetchGate;
          return new Response("export const value = 1;");
        },
        transformToESMImpl: async () => {
          transformCalls++;
          return "export const value = 1;";
        },
        loggerImpl: { debug: () => {}, error: () => {} },
      });

    const first = flow();
    const second = flow();
    await Promise.resolve();
    releaseFetch?.();

    assertEquals(await Promise.all([first, second]), [
      "/tmp/coalesced.mjs",
      "/tmp/coalesced.mjs",
    ]);
    assertEquals(fetchCalls, 1);
    assertEquals(transformCalls, 1);
    assertEquals(globalCrossProjectInProgress.size, 0);
  });

  it("does not persist cache entries for mutable version ranges", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    let fetchCalls = 0;

    const flow = () =>
      transformCrossProjectImportFlow({
        crossProjectImport: {
          ...crossProjectImport,
          specifier: "@acme-ui@^1.2.0/@/components/Button.tsx",
          version: "^1.2.0",
        },
        options: {
          projectId: "project-a",
          projectDir: "/project",
          dev: false,
          apiBaseUrl: "https://registry.example.com/api",
          adapter: denoAdapter,
        },
        cache: {
          hashContentAsync: async (content) => content.includes("second") ? "second" : "first",
          getTempPath: async (_path, hash) => `/tmp/${hash}.mjs`,
          getFs: () => createMockCacheFs(),
        },
        withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
        fetchImpl: async () => {
          fetchCalls++;
          return new Response(`export const value = ${
            JSON.stringify(
              fetchCalls === 1 ? "first" : "second",
            )
          };`);
        },
        transformToESMImpl: async (source) => source,
        loggerImpl: { debug: () => {}, error: () => {} },
      });

    assertEquals(await flow(), "/tmp/first.mjs");
    assertEquals(await flow(), "/tmp/second.mjs");
    assertEquals(fetchCalls, 2);
  });

  it("encodes registry path segments and rejects traversal identities", async () => {
    globalCrossProjectCache.clear();
    let fetchedUrl = "";

    await transformCrossProjectImportFlow({
      crossProjectImport: {
        ...crossProjectImport,
        specifier: "@acme-ui@1.2.3/@/components/My Button.tsx",
        path: "components/My Button.tsx",
      },
      options: {
        projectId: "project-a",
        projectDir: "/project",
        dev: true,
        apiBaseUrl: "https://registry.example.com/api",
        adapter: denoAdapter,
      },
      cache: {
        hashContentAsync: async () => "1234abcd",
        getTempPath: async () => "/tmp/encoded.mjs",
        getFs: () => createMockCacheFs(),
      },
      withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
      fetchImpl: async (input) => {
        fetchedUrl = String(input);
        return new Response("export const value = 1;");
      },
      transformToESMImpl: async () => "export const value = 1;",
      loggerImpl: { debug: () => {}, error: () => {} },
    });

    assertEquals(
      fetchedUrl,
      "https://registry.example.com/acme-ui@1.2.3/@/components/My%20Button.tsx",
    );
    await assertRejects(
      () =>
        transformCrossProjectImportFlow({
          crossProjectImport: {
            ...crossProjectImport,
            specifier: "@acme-ui@1.2.3/@/../secret.ts",
            path: "../secret.ts",
          },
          options: {
            projectId: "project-a",
            projectDir: "/project",
            dev: true,
            apiBaseUrl: "https://registry.example.com/api",
            adapter: denoAdapter,
          },
          cache: {
            hashContentAsync: async () => "unused",
            getTempPath: async () => "/tmp/unused.mjs",
            getFs: () => createMockCacheFs(),
          },
          withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
          fetchImpl: async () => new Response("unexpected"),
        }),
      Error,
      "Cross-project import identity is invalid",
    );
  });

  it("rejects registry URLs with request-controlled URL components", async () => {
    await assertRejects(
      () =>
        transformCrossProjectImportFlow({
          crossProjectImport,
          options: {
            projectId: "project-a",
            projectDir: "/project",
            dev: true,
            apiBaseUrl: "https://user:secret@registry.example.com/api?tenant=other",
            adapter: denoAdapter,
          },
          cache: {
            hashContentAsync: async () => "unused",
            getTempPath: async () => "/tmp/unused.mjs",
            getFs: () => createMockCacheFs(),
          },
          withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
          fetchImpl: async () => new Response("unexpected"),
        }),
      Error,
      "Cross-project registry URL is invalid",
    );
  });
});
