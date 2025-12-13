import { assert } from "std/assert/mod.ts";

Deno.test(
  {
    name: "Hydrator skips re-run when manifest hash unchanged (HMR no-op)",
    sanitizeOps: false,
    sanitizeResources: false,
  },
  async () => {
    const doc: any = {
      querySelectorAll() {
        return [];
      },
    } as any;
    (globalThis as any).__VERYFRONT_DEV__ = true;
    (globalThis as any).__VF_TEST_MODE__ = true;
    const manifest1 = {
      version: 1,
      hash: "abc",
      modules: [],
      graphIds: { client: [], server: [] },
    };
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = (url: string) => {
      if (String(url).includes("/_veryfront/rsc/manifest")) {
        return new Response(JSON.stringify(manifest1), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    };
    const { hydrateAllClientBoundaries } = await import("../../../src/rendering/rsc/hydrate-client.ts");
    await hydrateAllClientBoundaries(doc as any);
    assert((globalThis as any).__VF_MANIFEST_HASH === "abc");
    (globalThis as any).__VF_HYDRATE_CALLED = false;
    await hydrateAllClientBoundaries(doc as any);
    assert((globalThis as any).__VF_MANIFEST_HASH === "abc");
    assert((globalThis as any).__VF_HYDRATE_CALLED === false);

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
    assert((globalThis as any).__VF_MANIFEST_HASH === "def");
    (globalThis as any).fetch = origFetch;
    delete (globalThis as any).__VF_TEST_MODE__;
  },
);
