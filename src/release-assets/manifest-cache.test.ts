import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  getReadyManifestForBrowserModuleAdmission,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "./constants.ts";

/** Component the manifest cache logs under, and the only one these tests read. */
const MANIFEST_LOG_COMPONENT = "release-asset-manifest";

/**
 * Collect this component's structured log records for the duration of `run`.
 *
 * Reads the records operators actually consume rather than the rendered console
 * line: the reason exists to reach a log pipeline, so asserting on the record is
 * asserting on the thing that has to work. It also keeps the test off global
 * mutable state — patching `console.error` leaks across a file if a run throws
 * before it is restored, and couples every assertion to the text formatter.
 */
async function captureManifestLogs(run: () => Promise<void>): Promise<LogEntry[]> {
  const records: LogEntry[] = [];
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.component === MANIFEST_LOG_COMPONENT) records.push(entry);
  });
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return records;
}

/** The single error-level rejection record, or undefined when none was emitted. */
function rejectionRecord(records: LogEntry[]): LogEntry | undefined {
  return records.find((entry) => entry.level === "error");
}

function manifest(releaseId: string, manifestVersion: number): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: "project-1",
    releaseId,
    releaseVersion: 1,
    manifestVersion,
    builderVersion: "test",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-07-26T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencyMode: "source",
    dependencies: {},
  };
}

function readyManifestResponse(releaseId: string, manifestVersion: number) {
  const value = manifest(releaseId, manifestVersion);
  return {
    state: "ready",
    manifest_version: value.manifestVersion,
    manifest: value,
  };
}

describe("release asset manifest fetcher ownership", () => {
  const originalFlag = Deno.env.get("VERYFRONT_RELEASE_ASSET_MANIFEST");

  afterEach(() => {
    clearReleaseAssetManifestCache();
    if (originalFlag === undefined) {
      Deno.env.delete("VERYFRONT_RELEASE_ASSET_MANIFEST");
    } else {
      Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", originalFlag);
    }
  });

  it("does not let an older adapter cleanup remove a newer fetcher", async () => {
    const calls: string[] = [];
    clearReleaseAssetManifestCache();
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");

    const cleanupOlder = registerManifestFetcherForRelease("release-1", async () => {
      calls.push("older");
      return null;
    });
    const cleanupNewer = registerManifestFetcherForRelease("release-1", async () => {
      calls.push("newer");
      return null;
    });

    cleanupOlder();
    cleanupOlder();
    clearCachedReleaseAssetManifests();
    await getReadyManifestForRenderAsync("release-1");
    assertEquals(calls, ["newer"]);

    cleanupNewer();
    clearCachedReleaseAssetManifests();
    await getReadyManifestForRenderAsync("release-1");
    assertEquals(calls, ["newer"]);
  });

  it("reports why a ready manifest was rejected instead of only refusing it", async () => {
    // The failure this pins: assets built by a different framework version are
    // published as `ready` and refused here, which takes a site's whole client
    // bundle offline. Before this, the only operator-visible signal was a 503
    // and a timing mark, so version skew and a corrupt payload looked alike.
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    const skewed = manifest("release-skew", 1);
    registerManifestFetcherForRelease("release-skew", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: {
          ...skewed,
          schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION + 1,
        },
      }));

    const records = await captureManifestLogs(async () => {
      assertEquals(await getReadyManifestForRenderAsync("release-skew"), null);
    });

    // Error level is load-bearing: it is what separates "an operator must act"
    // from the debug-level "not ready yet" that is the normal path.
    const rejection = rejectionRecord(records);
    assertExists(rejection, "expected an error-level rejection record");
    assertEquals(rejection.context?.releaseId, "release-skew");

    // Assert on the versions the reason has to name, not its prose. Naming both
    // is what tells an operator to deploy a newer builder rather than rebuild.
    const reason = String(rejection.context?.reason ?? "");
    assertStringIncludes(reason, String(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION + 1));
    assertStringIncludes(reason, String(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION));
  });

  it("reports a ready response whose envelope has no usable manifest_version", async () => {
    // `state` is normalized to "invalid" when the envelope is unusable, so
    // classifying on it routed this rejection to debug, silencing one of the
    // exact reasons the diagnostic exists to surface. Classification follows
    // the publisher's claimed state instead.
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    registerManifestFetcherForRelease("release-envelope", () =>
      Promise.resolve({
        state: "ready",
        manifest_version: -1,
        manifest: manifest("release-envelope", 1),
      } as unknown as ReturnType<typeof readyManifestResponse>));

    const records = await captureManifestLogs(async () => {
      assertEquals(await getReadyManifestForRenderAsync("release-envelope"), null);
    });

    // Classifying on the derived `state` routes this to debug, which the level
    // gate drops before it ever reaches a subscriber — so an empty record set is
    // exactly the regression, and this assertion is what catches it.
    const rejection = rejectionRecord(records);
    assertExists(rejection, "expected an error-level rejection record");
    assertEquals(rejection.context?.releaseId, "release-envelope");
    assertStringIncludes(String(rejection.context?.reason ?? ""), "manifest_version");
  });

  it("keeps cache identities distinct for delimiter-shaped release IDs", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    const calls: string[] = [];
    registerManifestFetcherForRelease("release", () => {
      calls.push("release");
      return Promise.resolve(readyManifestResponse("release", 1));
    });
    registerManifestFetcherForRelease("release:1", () => {
      calls.push("release:1");
      return Promise.resolve(readyManifestResponse("release:1", 2));
    });

    assertEquals((await getReadyManifestForRenderAsync("release"))?.releaseId, "release");
    assertEquals((await getReadyManifestForRenderAsync("release:1"))?.releaseId, "release:1");
    assertEquals(calls, ["release", "release:1"]);

    // A non-ready result for the delimiter-shaped sibling writes to its own
    // plain cache slot. Under a delimiter-joined key that slot is the same
    // string as `release` at manifestVersion 1, so the sibling would evict it.
    registerManifestFetcherForRelease("release:1", () => Promise.resolve(null));
    await getReadyManifestForRenderAsync("release:1");
    assertEquals(
      getReadyManifestForRender("release")?.manifestVersion,
      1,
      "a delimiter-shaped sibling release must not evict this release's cached ready manifest",
    );
  });

  it("admits browser modules regardless of the release-manifest rollout flag", async () => {
    clearReleaseAssetManifestCache();
    Deno.env.delete("VERYFRONT_RELEASE_ASSET_MANIFEST");
    registerManifestFetcherForRelease(
      "release-1",
      () => Promise.resolve(readyManifestResponse("release-1", 1)),
    );

    assertEquals(
      (await getReadyManifestForBrowserModuleAdmission("release-1"))?.releaseId,
      "release-1",
      "browser-module admission must never be gated by the rollout flag",
    );
    assertEquals(
      await getReadyManifestForRenderAsync("release-1"),
      null,
      "render reads stay gated by the rollout flag",
    );
  });

  it("does not let a superseded in-flight fetch publish stale state", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    let resolveOlder:
      | ((value: ReturnType<typeof readyManifestResponse>) => void)
      | undefined;
    const olderResult = new Promise<ReturnType<typeof readyManifestResponse>>(
      (resolve) => {
        resolveOlder = resolve;
      },
    );

    registerManifestFetcherForRelease("release-1", () => olderResult);
    const olderRead = getReadyManifestForRenderAsync("release-1");

    registerManifestFetcherForRelease(
      "release-1",
      () => Promise.resolve(readyManifestResponse("release-1", 2)),
    );
    const newerRead = getReadyManifestForRenderAsync("release-1");
    resolveOlder?.(readyManifestResponse("release-1", 1));

    assertEquals((await newerRead)?.manifestVersion, 2);
    await olderRead;
    assertEquals((await getReadyManifestForRenderAsync("release-1"))?.manifestVersion, 2);
  });

  it("aborts a pending fetch when its cache generation is cleared", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    let signal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    registerManifestFetcherForRelease("release-1", (_releaseId, context) => {
      signal = context.signal;
      markStarted?.();
      return new Promise(() => undefined);
    });

    const pendingRead = getReadyManifestForRenderAsync("release-1");
    await started;
    clearCachedReleaseAssetManifests();

    assertEquals(signal?.aborted, true);
    assertEquals(await pendingRead, null);
  });

  it("rejects a manifest returned for a different release", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    registerManifestFetcherForRelease(
      "release-1",
      () => Promise.resolve(readyManifestResponse("release-2", 1)),
    );

    assertEquals(await getReadyManifestForRenderAsync("release-1"), null);
  });

  it("never invokes another release owner's fetcher", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    const calls: string[] = [];
    registerManifestFetcherForRelease("release-a", (releaseId) => {
      calls.push(releaseId);
      return Promise.resolve(readyManifestResponse("release-a", 1));
    });

    assertEquals(await getReadyManifestForRenderAsync("release-b"), null);
    assertEquals(calls, []);
    assertEquals(
      (await getReadyManifestForRenderAsync("release-a"))?.releaseId,
      "release-a",
    );
    assertEquals(calls, ["release-a"]);
  });
});
