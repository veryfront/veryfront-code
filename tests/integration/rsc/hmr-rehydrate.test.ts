import { assert } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";

describe(
  "RSC HMR Rehydration",
  {
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    it("Hydrator skips re-run when manifest hash unchanged (HMR no-op)", async () => {
      const doc = {
        querySelectorAll() {
          return [];
        },
      };

      const g = globalThis as any;
      g.__VERYFRONT_DEV__ = true;
      g.__VF_TEST_MODE__ = true;

      const manifest1 = {
        version: 1,
        hash: "abc",
        modules: [],
        graphIds: { client: [], server: [] },
      };

      const origFetch = globalThis.fetch;

      function setManifestFetch(manifest: unknown): void {
        g.fetch = (url: string) => {
          if (String(url).includes("/_veryfront/rsc/manifest")) {
            return new Response(JSON.stringify(manifest), {
              headers: { "content-type": "application/json" },
            });
          }
          return new Response("", { status: 404 });
        };
      }

      setManifestFetch(manifest1);

      const { hydrateAllClientBoundaries } = await import(
        "../../../src/rendering/rsc/hydrate-client.ts"
      );

      await hydrateAllClientBoundaries(doc as any);
      assert(g.__VF_MANIFEST_HASH === "abc");

      // Second run with same hash should return early and not flip the test flag again
      g.__VF_HYDRATE_CALLED = false;
      await hydrateAllClientBoundaries(doc as any);
      assert(g.__VF_MANIFEST_HASH === "abc");
      assert(g.__VF_HYDRATE_CALLED === false);

      // Change hash -> should set flag (indicates work would occur in real mode)
      const manifest2 = { ...manifest1, hash: "def" };
      setManifestFetch(manifest2);

      await hydrateAllClientBoundaries(doc as any);
      assert(g.__VF_MANIFEST_HASH === "def");

      // Cleanup
      g.fetch = origFetch;
      delete g.__VF_TEST_MODE__;
    });
  },
);
