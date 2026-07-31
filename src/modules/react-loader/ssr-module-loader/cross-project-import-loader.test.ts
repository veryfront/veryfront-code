import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CrossProjectImport } from "#veryfront/transforms/esm/import-parser.ts";
import { globalCrossProjectCache, globalCrossProjectInProgress } from "./cache/index.ts";
import {
  buildCrossProjectImportCacheKey,
  transformCrossProjectImportFlow,
} from "./cross-project-import-loader.ts";
import { isCrossProjectCacheKeyForProject } from "./cross-project-cache-key.ts";
import { createSSRImportMapIdentity } from "./import-map-identity.ts";

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
const SNAPSHOT_A_PIN_KEY = "on:3m96ohlm0kf87";
const SNAPSHOT_B_PIN_KEY = "on:htdjrangih5s";
const SNAPSHOT_A_DEPENDENCIES = Object.freeze({ lodash: "1.0.0" });
const SNAPSHOT_B_DEPENDENCIES = Object.freeze({ lodash: "2.0.0" });

interface FlowHarnessOptions {
  crossProjectImport?: CrossProjectImport;
  apiBaseUrl?: string;
  fs?: FileSystem;
  fetchImpl?: typeof fetch;
  fetchTimeoutMs?: number;
  hash?: string;
  tempPath?: string;
  onTransform?: () => void;
}

function createFlowHarness(
  harness: FlowHarnessOptions = {},
): Parameters<typeof transformCrossProjectImportFlow>[0] {
  return {
    crossProjectImport: harness.crossProjectImport ?? crossProjectImport,
    options: {
      projectId: "project-a",
      projectDir: "/project",
      dev: true,
      apiBaseUrl: harness.apiBaseUrl ?? "https://registry.example.com/api",
      adapter: denoAdapter,
    },
    cache: {
      hashContentAsync: () => Promise.resolve(harness.hash ?? "abcdef12"),
      getTempPath: () => Promise.resolve(harness.tempPath ?? "/tmp/cross-project-harness.mjs"),
      getFs: () => harness.fs ?? createMockCacheFs(),
    },
    withTransformCapacity: async (_syntheticFilePath, operation) => await operation(),
    fetchImpl: harness.fetchImpl ??
      (async () => new Response("export const remoteValue = 1;", { status: 200 })),
    transformToESMImpl: async (source) => {
      harness.onTransform?.();
      return source;
    },
    loggerImpl: { debug: () => {}, error: () => {} },
    fetchTimeoutMs: harness.fetchTimeoutMs,
  };
}

describe("modules/react-loader/ssr-module-loader/cross-project-import-loader", () => {
  it("builds injective cache keys and identifies exact project ownership", () => {
    const first = buildCrossProjectImportCacheKey({
      specifier: "package:feature",
      projectId: "tenant",
      registryBaseUrl: "https://registry.example.com",
    });
    const second = buildCrossProjectImportCacheKey({
      specifier: "package",
      projectId: "feature:tenant",
      registryBaseUrl: "https://registry.example.com",
    });

    assertEquals(first === second, false);
    assertEquals(isCrossProjectCacheKeyForProject(first, "tenant"), true);
    assertEquals(
      isCrossProjectCacheKeyForProject(first, "feature:tenant"),
      false,
    );
  });

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

  it("isolates cached cross-project modules by import-map fingerprint", async () => {
    globalCrossProjectCache.clear();
    const mapAIdentity = await createSSRImportMapIdentity({
      imports: { package: "https://modules.example/map-a.ts" },
      scopes: {},
    });
    const mapBIdentity = await createSSRImportMapIdentity({
      imports: { package: "https://modules.example/map-b.ts" },
      scopes: {},
    });
    const key = (fingerprint: string) =>
      buildCrossProjectImportCacheKey({
        specifier: crossProjectImport.specifier,
        projectId: "project-a",
        registryBaseUrl: "https://registry.example.com",
        importMapFingerprint: fingerprint,
      });
    globalCrossProjectCache.set(key(mapAIdentity.fingerprint), {
      tempPath: "/tmp/map-a.mjs",
      contentHash: "aaaa",
    });
    globalCrossProjectCache.set(key(mapBIdentity.fingerprint), {
      tempPath: "/tmp/map-b.mjs",
      contentHash: "bbbb",
    });

    const load = (importMapIdentity: typeof mapAIdentity) =>
      transformCrossProjectImportFlow({
        crossProjectImport,
        options: {
          projectId: "project-a",
          projectDir: "/project",
          dev: true,
          apiBaseUrl: "https://registry.example.com/api",
          adapter: denoAdapter,
          importMapIdentity,
        },
        cache: {
          hashContentAsync: async () => "unused",
          getTempPath: async () => "/tmp/unused.mjs",
          getFs: () => createMockCacheFs(),
        },
        withTransformCapacity: async () => {
          throw new Error("unexpected transform for fingerprint cache hit");
        },
        fetchImpl: async () => {
          throw new Error("unexpected fetch for fingerprint cache hit");
        },
      });

    assertEquals(await load(mapAIdentity), "/tmp/map-a.mjs");
    assertEquals(await load(mapBIdentity), "/tmp/map-b.mjs");
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
      dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
    });
    const snapshotB = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://app.example",
      dependencyPinningCacheKey: SNAPSHOT_B_PIN_KEY,
      dependencyPinningDependencies: SNAPSHOT_B_DEPENDENCIES,
    });
    const otherOrigin = buildCrossProjectImportCacheKey({
      ...base,
      moduleServerOrigin: "https://other.example",
      dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
      dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
    });

    assertNotEquals(snapshotA, snapshotB);
    assertNotEquals(snapshotA, otherOrigin);
  });

  it("rejects invalid dependency snapshots before a prepopulated cache can be reused", async () => {
    const base = {
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      registryBaseUrl: "https://registry.example.com",
    };
    const flagOffKey = buildCrossProjectImportCacheKey({
      ...base,
      dependencyPinningCacheKey: "off",
    });
    const invalidSnapshots = [
      {
        dependencyPinningCacheKey: "malformed",
        dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
      },
      {
        dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
      },
      {
        dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
        dependencyPinningDependencies: SNAPSHOT_B_DEPENDENCIES,
      },
    ] as const;

    for (const invalidSnapshot of invalidSnapshots) {
      globalCrossProjectCache.clear();
      globalCrossProjectCache.set(flagOffKey, {
        tempPath: "/tmp/flag-off-cross-project.mjs",
        contentHash: "cafe1234",
      });
      let fetchCalls = 0;

      await assertRejects(
        () =>
          transformCrossProjectImportFlow({
            ...createFlowHarness({
              fetchImpl: async () => {
                fetchCalls++;
                return new Response("unexpected");
              },
            }),
            options: {
              projectId: "project-a",
              projectDir: "/project",
              dev: true,
              apiBaseUrl: "https://registry.example.com/api",
              adapter: denoAdapter,
              ...invalidSnapshot,
            },
          }),
        Error,
        "dependency pinning snapshot",
      );
      assertEquals(fetchCalls, 0);
    }
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
      Error,
      "Cross-project source exceeds size limit",
    );

    assertEquals(transformed, false);
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

  it("rejects unsafe registry URLs and project paths before fetching", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls++;
      return new Response("unexpected");
    };

    await assertRejects(
      () =>
        transformCrossProjectImportFlow(
          createFlowHarness({
            apiBaseUrl: "file:///tmp/registry/api",
            fetchImpl,
          }),
        ),
      TypeError,
      "must use HTTP or HTTPS",
    );
    await assertRejects(
      () =>
        transformCrossProjectImportFlow(
          createFlowHarness({
            crossProjectImport: {
              ...crossProjectImport,
              path: "../secrets.ts",
            },
            fetchImpl,
          }),
        ),
      TypeError,
      "unsafe segment",
    );
    await assertRejects(
      () =>
        transformCrossProjectImportFlow(
          createFlowHarness({
            crossProjectImport: {
              ...crossProjectImport,
              path: "%2e%2e/secrets.ts",
            },
            fetchImpl,
          }),
        ),
      TypeError,
      "unsafe segment",
    );

    assertEquals(fetchCalls, 0);
  });

  it("re-fetches a cached entry whose temp file disappeared", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    const cacheKey = buildCrossProjectImportCacheKey({
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      registryBaseUrl: "https://registry.example.com",
    });
    globalCrossProjectCache.set(cacheKey, {
      tempPath: "/tmp/missing-cross-project.mjs",
      contentHash: "deadbeef",
    });
    let fetchCalls = 0;
    let statCalls = 0;

    const result = await transformCrossProjectImportFlow(
      createFlowHarness({
        fs: createMockCacheFs({
          stat: () => {
            statCalls++;
            if (statCalls === 1) {
              return Promise.reject(
                Object.assign(new Error("missing"), { code: "ENOENT" }),
              );
            }
            return Promise.resolve({
              isFile: true,
              isDirectory: false,
              isSymlink: false,
              size: 100,
              mtime: null,
            });
          },
        }),
        fetchImpl: async () => {
          fetchCalls++;
          return new Response("export const refreshed = true;");
        },
        tempPath: "/tmp/refreshed-cross-project.mjs",
      }),
    );

    assertEquals(result, "/tmp/refreshed-cross-project.mjs");
    assertEquals(fetchCalls, 1);
  });

  it("propagates operational cache-stat failures without fetching", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    const cacheKey = buildCrossProjectImportCacheKey({
      specifier: crossProjectImport.specifier,
      projectId: "project-a",
      registryBaseUrl: "https://registry.example.com",
    });
    globalCrossProjectCache.set(cacheKey, {
      tempPath: "/tmp/unreadable-cross-project.mjs",
      contentHash: "deadbeef",
    });
    let fetchCalls = 0;

    await assertRejects(
      () =>
        transformCrossProjectImportFlow(
          createFlowHarness({
            fs: createMockCacheFs({
              stat: () =>
                Promise.reject(
                  Object.assign(new Error("permission denied"), {
                    code: "EACCES",
                  }),
                ),
            }),
            fetchImpl: async () => {
              fetchCalls++;
              return new Response("unexpected");
            },
          }),
        ),
      Error,
      "permission denied",
    );

    assertEquals(fetchCalls, 0);
  });

  it("coalesces concurrent fetch and transform work for the same identity", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    let fetchCalls = 0;
    let transformCalls = 0;
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const flow = createFlowHarness({
      fetchImpl: async () => {
        fetchCalls++;
        await fetchGate;
        return new Response("export const shared = true;");
      },
      onTransform: () => {
        transformCalls++;
      },
    });

    const first = transformCrossProjectImportFlow(flow);
    const second = transformCrossProjectImportFlow(flow);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(fetchCalls, 1);
    assertEquals(globalCrossProjectInProgress.size, 1);

    releaseFetch();
    assertEquals(await Promise.all([first, second]), [
      "/tmp/cross-project-harness.mjs",
      "/tmp/cross-project-harness.mjs",
    ]);
    assertEquals(transformCalls, 1);
    assertEquals(globalCrossProjectInProgress.size, 0);
  });

  it("does not retain completed cache entries for latest imports", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    let fetchCalls = 0;
    let transformCalls = 0;
    const latestImport: CrossProjectImport = {
      specifier: "acme-ui/@/components/Button.tsx",
      projectSlug: "acme-ui",
      version: "latest",
      path: "components/Button.tsx",
    };
    const flow = createFlowHarness({
      crossProjectImport: latestImport,
      fetchImpl: async () => {
        fetchCalls++;
        return new Response(`export const revision = ${fetchCalls};`);
      },
      onTransform: () => {
        transformCalls++;
      },
    });

    await transformCrossProjectImportFlow(flow);
    await transformCrossProjectImportFlow(flow);

    assertEquals(fetchCalls, 2);
    assertEquals(transformCalls, 2);
    assertEquals(globalCrossProjectCache.size, 0);
  });

  it("keeps the fetch timeout active while the response body is streaming", async () => {
    globalCrossProjectCache.clear();
    globalCrossProjectInProgress.clear();
    let observedAbort = false;

    await assertRejects(() =>
      transformCrossProjectImportFlow(
        createFlowHarness({
          fetchTimeoutMs: 5,
          fetchImpl: async (_input, init) => {
            const signal = init && "signal" in init ? init.signal : undefined;
            if (!(signal instanceof AbortSignal)) {
              throw new TypeError("Expected fetch to receive an AbortSignal");
            }
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  signal.addEventListener(
                    "abort",
                    () => {
                      observedAbort = true;
                      controller.error(signal.reason);
                    },
                    { once: true },
                  );
                },
              }),
              { status: 200 },
            );
          },
        }),
      )
    );

    assertEquals(observedAbort, true);
    assertEquals(globalCrossProjectInProgress.size, 0);
  });
});
