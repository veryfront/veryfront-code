import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCachedReleaseAssetManifests,
  type ReleaseAssetManifest,
  type ReleaseAssetManifestFetcher,
} from "veryfront/release-assets";
import {
  buildCliProxyProductionServerOptions,
  CliReleaseAssetManifestError,
  CliServerStartupCleanupError,
  createCliProductionManifestCoordinator,
  createCliServerCleanup,
  finalizeCliServerStartup,
  loadCliReleaseAssetManifest,
} from "./server-startup.ts";

function validReleaseManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "11111111-1111-1111-1111-111111111111",
    releaseId: "22222222-2222-2222-2222-222222222222",
    releaseVersion: 7,
    manifestVersion: 1,
    builderVersion: "0.1.765",
    sourceContentHash: "source-hash",
    createdAt: "2026-07-24T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

function manifestFetcher(
  manifest: ReleaseAssetManifest,
): ReleaseAssetManifestFetcher {
  return () => Promise.resolve({ state: "ready", manifest });
}

describe("buildCliProxyProductionServerOptions()", () => {
  it("explicitly authorizes only the local CLI proxy startup path", () => {
    const signal = new AbortController().signal;
    const requestInterceptor = (request: Request): Request => request;

    const options = buildCliProxyProductionServerOptions({
      port: 4_321,
      projectDir: "/local/project",
      signal,
      requestInterceptor,
      defaultProjectSlug: "local-project",
      defaultProjectId: "project-id",
    });

    assertEquals("startupContext" in options, false);
    assertEquals(options.port, 4_321);
    assertEquals(options.projectDir, "/local/project");
    assertStrictEquals(options.signal, signal);
    assertStrictEquals(options.requestInterceptor, requestInterceptor);
  });
});

describe("loadCliReleaseAssetManifest()", () => {
  it("treats only a genuine missing file as an optional manifest", async () => {
    const missing = Object.assign(new Error("manifest missing"), {
      code: "ENOENT",
    });

    const manifest = await loadCliReleaseAssetManifest(
      {
        readFile: () => Promise.reject(missing),
      },
      "/project/dist/release-assets.json",
    );

    assertEquals(manifest, null);
  });

  it("propagates unreadable manifests instead of silently falling back", async () => {
    const unreadable = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    let received: unknown;

    try {
      await loadCliReleaseAssetManifest(
        {
          readFile: () => Promise.reject(unreadable),
        },
        "/project/dist/release-assets.json",
      );
    } catch (error) {
      received = error;
    }

    assertInstanceOf(received, CliReleaseAssetManifestError);
    assertStrictEquals(received.cause, unreadable);
  });

  it("rejects malformed JSON and schema-invalid built manifests", async () => {
    await assertRejects(
      () =>
        loadCliReleaseAssetManifest(
          { readFile: () => Promise.resolve("{ malformed") },
          "/project/dist/release-assets.json",
        ),
      CliReleaseAssetManifestError,
      "not valid JSON",
    );
    await assertRejects(
      () =>
        loadCliReleaseAssetManifest(
          {
            readFile: () =>
              Promise.resolve(
                JSON.stringify({ schemaVersion: 1, releaseId: "incomplete" }),
              ),
          },
          "/project/dist/release-assets.json",
        ),
      CliReleaseAssetManifestError,
      "failed schema validation",
    );
  });

  it("returns a schema-valid built manifest", async () => {
    const expected = validReleaseManifest();
    const manifest = await loadCliReleaseAssetManifest(
      {
        readFile: () => Promise.resolve(JSON.stringify(expected)),
      },
      "/project/dist/release-assets.json",
    );

    assertEquals(manifest, expected);
  });
});

describe("CLI production manifest ownership", () => {
  it("uses the cache-only primitive exported by the public release-assets barrel", () => {
    assertEquals(typeof clearCachedReleaseAssetManifests, "function");
  });

  it("prevents a contender from overwriting a live generation and makes stale cleanup inert", () => {
    let configuredFetcher: ReleaseAssetManifestFetcher | undefined;
    let cacheClearCalls = 0;
    const coordinator = createCliProductionManifestCoordinator({
      configureFetcher: (fetcher) => {
        configuredFetcher = fetcher;
      },
      clearCachedManifests: () => {
        cacheClearCalls++;
      },
    });
    const firstFetcher = manifestFetcher(validReleaseManifest());
    const first = coordinator.acquire();
    first.register(firstFetcher);

    assertStrictEquals(configuredFetcher, firstFetcher);
    assertThrows(
      () => coordinator.acquire(),
      Error,
      "already active",
    );
    assertStrictEquals(configuredFetcher, firstFetcher);

    first.release();
    const secondFetcher = manifestFetcher({
      ...validReleaseManifest(),
      releaseId: "33333333-3333-3333-3333-333333333333",
    });
    const second = coordinator.acquire();
    second.register(secondFetcher);

    first.release();
    assertStrictEquals(configuredFetcher, secondFetcher);
    assertThrows(
      () => first.register(firstFetcher),
      Error,
      "no longer active",
    );

    second.release();
    assertEquals(configuredFetcher, undefined);
    assertEquals(cacheClearCalls, 4);
  });

  it("retains ownership across cleanup failure and permits a retry before the next generation", async () => {
    const cleanupError = new Error("global manifest unregister failed");
    let configuredFetcher: ReleaseAssetManifestFetcher | undefined;
    let failUnregister = true;
    const coordinator = createCliProductionManifestCoordinator({
      configureFetcher: (fetcher) => {
        if (!fetcher && failUnregister) {
          failUnregister = false;
          throw cleanupError;
        }
        configuredFetcher = fetcher;
      },
      clearCachedManifests: () => {},
    });
    const firstFetcher = manifestFetcher(validReleaseManifest());
    const first = coordinator.acquire();
    first.register(firstFetcher);
    const cleanup = createCliServerCleanup([() => first.release()]);

    await assertRejects(cleanup, Error, cleanupError.message);
    assertStrictEquals(configuredFetcher, firstFetcher);
    assertThrows(
      () => coordinator.acquire(),
      Error,
      "already active",
    );

    await cleanup();
    assertEquals(configuredFetcher, undefined);

    const next = coordinator.acquire();
    const nextFetcher = manifestFetcher({
      ...validReleaseManifest(),
      releaseId: "44444444-4444-4444-4444-444444444444",
    });
    next.register(nextFetcher);
    assertStrictEquals(configuredFetcher, nextFetcher);
    next.release();
  });
});

describe("finalizeCliServerStartup()", () => {
  it("stops a live server and preserves the primary content-processor failure", async () => {
    const primaryError = new Error("content processor failed");
    let stopCalls = 0;
    const server = {
      stop: () => {
        stopCalls++;
        return Promise.resolve();
      },
    };

    let received: unknown;
    try {
      await finalizeCliServerStartup(
        server,
        {
          ensureContentProcessor: () => Promise.reject(primaryError),
        },
      );
    } catch (error) {
      received = error;
    }

    assertStrictEquals(received, primaryError);
    assertEquals(stopCalls, 1);
  });

  it("preserves both failures and exposes retryable cleanup when stop initially fails", async () => {
    const primaryError = new Error("content processor failed");
    const cleanupError = new Error("server stop failed");
    let stopCalls = 0;
    const server = {
      stop: () => {
        stopCalls++;
        return stopCalls === 1 ? Promise.reject(cleanupError) : Promise.resolve();
      },
    };

    let received: unknown;
    try {
      await finalizeCliServerStartup(
        server,
        {
          ensureContentProcessor: () => Promise.reject(primaryError),
        },
      );
    } catch (error) {
      received = error;
    }

    assertInstanceOf(received, CliServerStartupCleanupError);
    assertStrictEquals(received.errors[0], primaryError);
    assertStrictEquals(received.errors[1], cleanupError);
    await received.retryCleanup();
    assertEquals(stopCalls, 2);
  });
});

describe("createCliServerCleanup()", () => {
  it("shares an in-flight cleanup attempt", async () => {
    let cleanupCalls = 0;
    let releaseCleanup!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanup = createCliServerCleanup([
      async () => {
        cleanupCalls++;
        await gate;
      },
    ]);

    const first = cleanup();
    const second = cleanup();
    assertStrictEquals(first, second);
    assertEquals(cleanupCalls, 0);

    releaseCleanup();
    await Promise.all([first, second]);
    assertEquals(cleanupCalls, 1);
    assertStrictEquals(cleanup(), first);
  });

  it("keeps global cleanup behind server shutdown and retries only unfinished phases", async () => {
    let stopCalls = 0;
    let globalCleanupCalls = 0;
    const cleanup = createCliServerCleanup([
      () => {
        stopCalls++;
        if (stopCalls === 1) {
          throw new Error("transient stop failure");
        }
      },
      () => {
        globalCleanupCalls++;
      },
    ]);

    await assertRejects(cleanup, Error, "transient stop failure");
    assertEquals(globalCleanupCalls, 0);

    await cleanup();
    await cleanup();
    assertEquals(stopCalls, 2);
    assertEquals(globalCleanupCalls, 1);
  });
});
