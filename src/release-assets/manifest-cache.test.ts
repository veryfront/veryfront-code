import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "./constants.ts";

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

  it("does not reserve a real release ID for the global fallback", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    configureReleaseAssetManifestFetcher(() => Promise.resolve(readyManifestResponse("other", 1)));
    registerManifestFetcherForRelease(
      "*",
      () => Promise.resolve(readyManifestResponse("*", 2)),
    );

    const resolved = await getReadyManifestForRenderAsync("*");
    assertEquals(resolved?.releaseId, "*");
    assertEquals(resolved?.manifestVersion, 2);
    assert(resolved !== null);
  });

  it("does not reuse a cached manifest across fallback owners", async () => {
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve(readyManifestResponse("release-1", 1))
    );
    assertEquals(
      (await getReadyManifestForRenderAsync("release-1"))?.manifestVersion,
      1,
    );

    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve(readyManifestResponse("release-1", 2))
    );
    assertEquals(
      (await getReadyManifestForRenderAsync("release-1"))?.manifestVersion,
      2,
    );
  });
});
