import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import { globalCrossProjectCache } from "./cache/index.ts";
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
    const cacheKey = `${crossProjectImport.specifier}:project-a:default`;
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
        fetchedHeaders = init?.headers as Headers;
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
    const expectedCacheKey = `${crossProjectImport.specifier}:project-a:19.1.1`;

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

  it("throws with equivalent fetch error message and logs failure context", async () => {
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
      "Failed to fetch https://registry.example.com/acme-ui@1.2.3/@/components/Button.tsx: 404 Not Found",
    );

    assertEquals(errorLogMessage, "[SSR-MODULE-LOADER] Failed to fetch cross-project import");
    const context = errorLogContext as Record<string, unknown> | undefined;
    assertEquals(context?.specifier, crossProjectImport.specifier);
    assertEquals(
      context?.registryUrl,
      "https://registry.example.com/acme-ui@1.2.3/@/components/Button.tsx",
    );
    assertEquals(
      context?.error,
      "Failed to fetch https://registry.example.com/acme-ui@1.2.3/@/components/Button.tsx: 404 Not Found",
    );
  });
});
