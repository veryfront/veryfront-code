import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import type { TransformOptions } from "#veryfront/transforms/esm/types.ts";
import { CrossProjectSourceTooLargeError } from "#veryfront/modules/server/cross-project-source-limit.ts";
import { globalCrossProjectCache } from "./cache/index.ts";
import {
  buildCrossProjectImportCacheKey,
  transformCrossProjectImportFlow,
} from "./cross-project-import-loader.ts";

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
const SNAPSHOT_A_PIN_KEY = "on:34n9smy47dk9";
const SNAPSHOT_B_PIN_KEY = "on:34n8mjmdp7io";

describe("modules/react-loader/ssr-module-loader/cross-project-import-loader", () => {
  it("returns cached temp path without fetching", async () => {
    globalCrossProjectCache.clear();
    const cacheKey = buildCrossProjectImportCacheKey({
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      registryBaseUrl: "https://registry.example.com",
    });
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
        moduleServerOrigin: "https://app.example",
        dependencyPinningCacheKey: "off",
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

  it("preserves the mainline off key and isolates enabled snapshots and origins", () => {
    const base = {
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      reactVersion: "19.1.1",
      registryBaseUrl: "https://registry.example.com",
    };
    const unkeyed = buildCrossProjectImportCacheKey(base);
    const flagOff = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://app.example",
      dependencyPinningCacheKey: "off",
    });
    assertEquals(flagOff, unkeyed);

    const snapshotA = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://app.example",
      dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
    });
    const snapshotB = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://app.example",
      dependencyPinningCacheKey: SNAPSHOT_B_PIN_KEY,
    });
    const otherOrigin = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://other.example",
      dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
    });

    assertNotEquals(snapshotA, snapshotB);
    assertNotEquals(snapshotA, otherOrigin);
  });

  it("frames opaque project ids separately from colon-delimited specifiers", () => {
    const shared = {
      reactVersion: "19.1.1",
      registryBaseUrl: "https://registry.example.com",
    };
    const colonInSpecifier = buildCrossProjectImportCacheKey({
      ...shared,
      specifier: "@acme/component:tenant",
      projectId: "project:01J2XYZ",
    });
    const colonInProjectId = buildCrossProjectImportCacheKey({
      ...shared,
      specifier: "@acme/component",
      projectId: "tenant:project:01J2XYZ",
    });

    assertNotEquals(
      colonInSpecifier,
      colonInProjectId,
      "specifier and opaque project-id delimiters must not collapse to the same cache key",
    );
  });

  it("fetches, transforms, writes temp file, and caches transformed cross-project import", async () => {
    globalCrossProjectCache.clear();

    let fetchedUrl = "";
    let fetchedHeaders: Headers | undefined;
    let injectedContextCount = 0;
    let capacityPath = "";
    let transformedFilePath = "";
    let capturedProjectDir = "";
    let capturedAdapter: unknown;
    let capturedOpts: TransformOptions | undefined;
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
      transformToESMImpl: async (_source, filePathWithExt, projectDir, adapter, transformOpts) => {
        transformedFilePath = filePathWithExt;
        capturedProjectDir = projectDir;
        capturedAdapter = adapter;
        capturedOpts = transformOpts;
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
    const expectedCacheKey = buildCrossProjectImportCacheKey({
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      reactVersion: "19.1.1",
      registryBaseUrl: "https://registry.example.com",
    });

    assertEquals(result, "/tmp/cross-project-transformed.mjs");
    assertEquals(fetchedUrl, expectedRegistryUrl);
    assertEquals(fetchedHeaders?.get("Accept"), "text/plain, application/javascript, */*");
    assertEquals(fetchedHeaders?.get("x-trace-id"), "trace-123");
    assertEquals(injectedContextCount, 1);
    assertEquals(capacityPath, "cross-project/acme-ui@1.2.3/@/components/Button.tsx");
    assertEquals(transformedFilePath, "cross-project/acme-ui@1.2.3/@/components/Button.tsx");
    assertEquals(capturedOpts?.ssr, true, "cross-project SSR transform must set ssr");
    assertEquals(capturedOpts?.dev, true, "dev flag must be forwarded to the transform");
    assertEquals(
      capturedOpts?.projectId,
      "project-a",
      "projectId must be forwarded to the transform",
    );
    assertEquals(
      capturedOpts?.apiBaseUrl,
      "https://registry.example.com/api",
      "apiBaseUrl must be forwarded to the transform",
    );
    assertEquals(
      capturedOpts?.reactVersion,
      "19.1.1",
      "reactVersion must be forwarded to the transform",
    );
    assertEquals(capturedProjectDir, "/project", "projectDir must be forwarded to the transform");
    assertStrictEquals(
      capturedAdapter,
      denoAdapter,
      "runtime adapter must be forwarded to the transform",
    );
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

  it("separates cross-project cache entries by API base URL", async () => {
    globalCrossProjectCache.clear();

    const fetchedUrls: string[] = [];
    let writeCount = 0;

    const createFlowOptions = (apiBaseUrl: string) => ({
      crossProjectImport,
      options: {
        projectId: "project-a",
        projectDir: "/project",
        dev: true,
        apiBaseUrl,
        reactVersion: "19.1.1",
        adapter: denoAdapter,
      },
      cache: {
        hashContentAsync: async (content: string) =>
          content.includes("registry-a") ? "hash-registry-a" : "hash-registry-b",
        getTempPath: async (_filePath: string, contentHash?: string) =>
          `/tmp/${contentHash ?? "missing"}.mjs`,
        getFs: () =>
          createMockCacheFs({
            writeTextFile: async () => {
              writeCount++;
            },
          }),
      },
      withTransformCapacity: async <T>(_syntheticFilePath: string, operation: () => Promise<T>) =>
        await operation(),
      fetchImpl: async (input: URL | RequestInfo) => {
        const url = String(input);
        fetchedUrls.push(url);
        const source = url.includes("registry-a")
          ? "export const registry = 'registry-a';"
          : "export const registry = 'registry-b';";
        return new Response(source, { status: 200 });
      },
      transformToESMImpl: async (source: string) => source,
      loggerImpl: { debug: () => {}, error: () => {} },
    });

    const registryAPath = await transformCrossProjectImportFlow(
      createFlowOptions("https://registry-a.example.com/api"),
    );
    const registryBPath = await transformCrossProjectImportFlow(
      createFlowOptions("https://registry-b.example.com/api"),
    );

    assertEquals(registryAPath, "/tmp/hash-registry-a.mjs");
    assertEquals(registryBPath, "/tmp/hash-registry-b.mjs");
    assertEquals(fetchedUrls, [
      "https://registry-a.example.com/acme-ui@1.2.3/@/components/Button.tsx",
      "https://registry-b.example.com/acme-ui@1.2.3/@/components/Button.tsx",
    ]);
    assertEquals(writeCount, 2);
    assertEquals(globalCrossProjectCache.size, 2);
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
      CrossProjectSourceTooLargeError,
      "Cross-project source exceeds size limit",
    );

    assertEquals(transformed, false);
  });

  it("throws with equivalent fetch error message and logs failure context", async () => {
    globalCrossProjectCache.clear();

    let errorLogMessage = "";
    let errorLogContext: unknown;

    const error = await assertRejects(
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
      VeryfrontError,
      "Failed to fetch https://registry.example.com/acme-ui@1.2.3/@/components/Button.tsx: 404 Not Found",
    ) as VeryfrontError;

    assertEquals(
      error.slug,
      "network-error",
      "registry fetch failures stay classified as network errors",
    );
    assertEquals(error.status, 502, "upstream registry failure must map to 502");

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

  it("forwards dependency pinning inputs into the cross-project transform", async () => {
    globalCrossProjectCache.clear();

    const pinnedDependencies: Readonly<Record<string, string>> = { react: "19.1.1" };
    const pinningSource = "/project/package.json";
    let capturedOpts: TransformOptions | undefined;

    const result = await transformCrossProjectImportFlow({
      crossProjectImport,
      options: {
        projectId: "project-a",
        projectDir: "/project",
        dev: false,
        apiBaseUrl: "https://registry.example.com/api",
        moduleServerOrigin: "https://app.example",
        reactVersion: "19.1.1",
        dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
        dependencyPinningDependencies: pinnedDependencies,
        dependencyPinningSource: pinningSource,
        adapter: denoAdapter,
      },
      cache: {
        hashContentAsync: async () => "pinnedhash",
        getTempPath: async () => "/tmp/cross-project-pinned.mjs",
        getFs: () => createMockCacheFs(),
      },
      withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
      fetchImpl: async () => new Response("export const remoteValue = 1;", { status: 200 }),
      transformToESMImpl: async (
        _source,
        _filePathWithExt,
        _projectDir,
        _adapter,
        transformOpts,
      ) => {
        capturedOpts = transformOpts;
        return "export const transformed = true;";
      },
      loggerImpl: { debug: () => {}, error: () => {} },
    });

    assertEquals(result, "/tmp/cross-project-pinned.mjs");
    assertEquals(
      capturedOpts?.moduleServerOrigin,
      "https://app.example",
      "moduleServerOrigin must reach the cross-project transform",
    );
    assertEquals(
      capturedOpts?.dependencyPinningCacheKey,
      SNAPSHOT_A_PIN_KEY,
      "dependency pinning cache key must reach the cross-project transform",
    );
    assertStrictEquals(
      capturedOpts?.dependencyPinningDependencies,
      pinnedDependencies,
      "pinned dependency map must reach the cross-project transform unchanged",
    );
    assertStrictEquals(
      capturedOpts?.dependencyPinningSource,
      pinningSource,
      "pinning source must reach the cross-project transform unchanged",
    );

    const expectedCacheKey = buildCrossProjectImportCacheKey({
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      reactVersion: "19.1.1",
      registryBaseUrl: "https://registry.example.com",
      moduleServerOrigin: "https://app.example",
      dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
    });
    assertEquals(
      globalCrossProjectCache.get(expectedCacheKey)?.tempPath,
      "/tmp/cross-project-pinned.mjs",
      "pinned variant must be cached under its pinning-scoped key",
    );
  });

  it("throws and caches nothing when the transformed temp file cannot be written", async () => {
    globalCrossProjectCache.clear();

    const error = await assertRejects(
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
            hashContentAsync: async () => "1234abcd",
            getTempPath: async () => "/tmp/cross-project-unwritable.mjs",
            getFs: () =>
              createMockCacheFs({
                writeTextFile: () =>
                  Promise.reject(new Deno.errors.NotFound("/tmp/cross-project-unwritable.mjs")),
              }),
          },
          withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
          fetchImpl: async () => new Response("export const remoteValue = 1;", { status: 200 }),
          transformToESMImpl: async () => "export const transformed = true;",
          loggerImpl: { debug: () => {}, error: () => {} },
        }),
      VeryfrontError,
      "Failed to write cross-project import cache file: /tmp/cross-project-unwritable.mjs",
    ) as VeryfrontError;

    assertEquals(
      error.slug,
      "cache-error",
      "a failed cross-project cache write must be classified as a cache error",
    );
    assertEquals(
      globalCrossProjectCache.size,
      0,
      "a module whose temp file was not written must not be cached",
    );
  });
});
