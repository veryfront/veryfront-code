import { assert } from "@std/assert";

Deno.test(
  {
    name: "Hydrator skips re-run when manifest hash unchanged (HMR no-op)",
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async () => {
    // Fake document with no client boundaries
    const doc: any = {
      querySelectorAll() {
        return [];
      },
    } as any;
    (globalThis as any).__VERYFRONT_DEV__ = true;
    (globalThis as any).__VF_TEST_MODE__ = true;
    // First run sets hash
    const manifest1 = {
      version: 1,
      hash: "abc",
      modules: [],
      graphIds: { client: [], server: [] },
    };
    // Monkey-patch fetch
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = (url: string) => {
      if (String(url).includes("/_veryfront/rsc/manifest")) {
        return new Response(JSON.stringify(manifest1), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    };
    const { hydrateAllClientBoundaries } = await import(
      "../../../src/rendering/rsc/hydrate-client.ts"
    );
    await hydrateAllClientBoundaries(doc as any);
    assert((globalThis as any).__VF_MANIFEST_HASH === "abc"); // Second run with same hash should return early and not flip the test flag again
    (globalThis as any).__VF_HYDRATE_CALLED = false;
    await hydrateAllClientBoundaries(doc as any);
    assert((globalThis as any).__VF_MANIFEST_HASH === "abc");
    assert((globalThis as any).__VF_HYDRATE_CALLED === false);

    // Change hash -> should set flag (indicates work would occur in real mode)
    const manifest2 = { ...manifest1, hash: "def" };
    (globalThis as any).fetch = (url: string) => {
      if (String(url).includes("/_veryfront/rsc/manifest")) {
        return new Response(JSON.stringify(manifest2), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    };
    await hydrateAllClientBoundaries(doc as any);
    assert((globalThis as any).__VF_MANIFEST_HASH === "def"); // Cleanup
    (globalThis as any).fetch = origFetch;
    delete (globalThis as any).__VF_TEST_MODE__;
  },
);
