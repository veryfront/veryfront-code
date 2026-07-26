import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";

describe("release asset manifest fetcher ownership", () => {
  it("does not let an older adapter cleanup remove a newer fetcher", async () => {
    const originalFlag = Deno.env.get("VERYFRONT_RELEASE_ASSET_MANIFEST");
    const calls: string[] = [];
    clearReleaseAssetManifestCache();
    Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", "1");

    try {
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
    } finally {
      clearReleaseAssetManifestCache();
      if (originalFlag === undefined) {
        Deno.env.delete("VERYFRONT_RELEASE_ASSET_MANIFEST");
      } else {
        Deno.env.set("VERYFRONT_RELEASE_ASSET_MANIFEST", originalFlag);
      }
    }
  });
});
