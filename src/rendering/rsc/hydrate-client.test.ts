import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildHydrationManifestHeaders,
  buildHydrationManifestUrl,
  importClientModule,
  parseClientRef,
  readClientBoundaryChildren,
  readClientBoundaryProps,
  resolveClientBoundaryModuleUrl,
  selectTopLevelClientBoundaries,
} from "./hydrate-client.ts";
import {
  __resetDependencySnapshotRecoveryForTests,
  recoverFromSnapshotBoundModuleFailure,
} from "./dependency-snapshot-recovery.ts";

describe("rendering/rsc/hydrate-client", () => {
  afterEach(() => {
    __resetDependencySnapshotRecoveryForTests();
  });

  it("requests the manifest snapshot by header without changing its URL", () => {
    assertEquals(
      buildHydrationManifestUrl({
        dependencyPinningCacheKey: "on:pins-a",
      }),
      "/_veryfront/rsc/manifest",
    );
    assertEquals(
      buildHydrationManifestHeaders({
        dependencyPinningCacheKey: "on:pins-a",
      }),
      { "x-veryfront-dependency-pins": "on:pins-a" },
    );
    assertEquals(buildHydrationManifestUrl(null), "/_veryfront/rsc/manifest");
    assertEquals(
      buildHydrationManifestUrl({ dependencyPinningCacheKey: "off" }),
      "/_veryfront/rsc/manifest",
    );
    assertEquals(
      buildHydrationManifestHeaders({ dependencyPinningCacheKey: "off" }),
      {},
    );
  });

  it("accepts same-origin Veryfront module references emitted by the server renderer", () => {
    assertEquals(parseClientRef("/_veryfront/fs/client-component.js#default"), {
      moduleUrl: "/_veryfront/fs/client-component.js",
      exportName: "default",
    });
  });

  it("accepts remote RSC module references with named exports", () => {
    assertEquals(
      parseClientRef(
        "/_veryfront/rsc/module?rel=frontend%2FButton.tsx#Button",
      ),
      {
        moduleUrl: "/_veryfront/rsc/module?rel=frontend%2FButton.tsx",
        exportName: "Button",
      },
    );
  });

  it("rejects client refs outside the Veryfront module namespace", () => {
    assertEquals(
      parseClientRef("https://evil.example/x.js#default"),
      null,
      "absolute cross-origin refs are rejected",
    );
    assertEquals(
      parseClientRef("//evil.example/x.js#default"),
      null,
      "protocol-relative refs are rejected",
    );
    assertEquals(parseClientRef("foo/bar.js#default"), null, "bare relative refs are rejected");
    assertEquals(
      parseClientRef("/_veryfront/fs/x.js"),
      null,
      "a ref without an export fragment is rejected",
    );
    assertEquals(
      parseClientRef("/other/x.js#default"),
      null,
      "non-/_veryfront absolute paths are rejected",
    );
  });

  it("reads the serialized props emitted for a client boundary", () => {
    const element = {
      dataset: { rscProps: '{"label":"Save","count":2}' },
    } as unknown as HTMLElement;

    assertEquals(readClientBoundaryProps(element), { label: "Save", count: 2 });
  });

  it("falls back to empty props for malformed boundary props", () => {
    for (const serialized of ["{invalid", "[1,2]", "null", '"x"']) {
      assertEquals(
        readClientBoundaryProps(
          { dataset: { rscProps: serialized } } as unknown as HTMLElement,
        ),
        {},
        `${serialized} must fall back to empty props`,
      );
    }

    assertEquals(
      readClientBoundaryProps({ dataset: {} } as unknown as HTMLElement),
      {},
      "a boundary without serialized props must yield empty props",
    );
  });

  it("reads the versioned recursive children emitted for a client boundary", () => {
    const element = {
      dataset: {
        rscChildren: JSON.stringify({
          version: 1,
          nodes: [{
            type: "server",
            component: "strong",
            props: { id: "server" },
            children: [{ type: "html", text: "server child" }],
          }],
        }),
      },
    } as unknown as HTMLElement;

    assertEquals(readClientBoundaryChildren(element), [{
      type: "server",
      component: "strong",
      props: { id: "server" },
      children: [{ type: "html", text: "server child" }],
    }]);
  });

  it("selects only top-level DOM boundaries so nested payload children do not get a second root", () => {
    type TestElement = HTMLElement & { id: string; parentElement: TestElement | null };
    const outer = { id: "outer", parentElement: null } as TestElement;
    const wrapper = { id: "wrapper", parentElement: outer } as TestElement;
    const nested = { id: "nested", parentElement: wrapper } as TestElement;
    const sibling = { id: "sibling", parentElement: null } as TestElement;
    const doc = {
      querySelectorAll: () => [outer, nested, sibling],
    } as unknown as Document;

    assertEquals(
      selectTopLevelClientBoundaries(doc).map((element) => element.id),
      ["outer", "sibling"],
    );
  });

  it("resolves logical refs to local and remote hydration module URLs", () => {
    const reference = parseClientRef("/app/Counter.tsx#default")!;
    const manifest = {
      version: 1,
      hash: "abc123",
      modules: [],
      graphIds: {
        client: [{
          id: "Counter",
          path: "/project/app/Counter.tsx",
          rel: "/Counter.tsx",
        }],
        server: [],
      },
    };

    assertEquals(
      resolveClientBoundaryModuleUrl(manifest, reference, "fs"),
      "/_veryfront/fs/L3Byb2plY3QvYXBwL0NvdW50ZXIudHN4.js?v=abc123",
    );
    assertEquals(
      resolveClientBoundaryModuleUrl(manifest, reference, "rsc-module"),
      "/_veryfront/rsc/module?rel=%2FCounter.tsx&v=abc123",
    );
  });

  it("versions logical and direct RSC module refs by dependency snapshot", () => {
    const manifest = {
      version: 1,
      hash: "abc123",
      dependencyPinningCacheKey: "on:pins-a",
      modules: [],
      graphIds: {
        client: [{
          id: "Counter",
          path: "/project/app/Counter.tsx",
          rel: "/Counter.tsx",
        }],
        server: [],
      },
    };

    assertEquals(
      resolveClientBoundaryModuleUrl(
        manifest,
        parseClientRef("/app/Counter.tsx#default")!,
        "rsc-module",
      ),
      "/_veryfront/rsc/module?rel=%2FCounter.tsx&v=abc123&pins=on%3Apins-a",
    );
    assertEquals(
      resolveClientBoundaryModuleUrl(
        manifest,
        parseClientRef(
          "/_veryfront/rsc/module?rel=app%2FCounter.tsx&pins=on%3Astale-a&pins=on%3Astale-b#default",
        )!,
        "rsc-module",
      ),
      "/_veryfront/rsc/module?rel=app%2FCounter.tsx&pins=on%3Apins-a",
    );
  });

  it("prefers release asset module URLs for remote client boundaries", () => {
    const reference = parseClientRef("/app/Counter.tsx#default")!;
    const manifest = {
      version: 1,
      hash: "abc123",
      modules: [],
      graphIds: {
        client: [{
          id: "Counter",
          path: "/project/app/Counter.tsx",
          rel: "/Counter.tsx",
        }],
        server: [],
      },
    };

    assertEquals(
      resolveClientBoundaryModuleUrl(
        manifest,
        reference,
        "rsc-module",
        { "Counter.tsx": "/_vf_modules/Counter.abc123.js" },
      ),
      "/_vf_modules/Counter.abc123.js",
    );
  });

  it("recovers a snapshot-bound client boundary after its dynamic import fails", async () => {
    const importedUrls: string[] = [];
    const probedUrls: string[] = [];
    const cacheModes: (RequestCache | undefined)[] = [];
    let reloads = 0;
    const reference = parseClientRef(
      "/_veryfront/rsc/module?rel=app%2FCounter.tsx#default",
    )!;
    const manifest = {
      version: 1,
      hash: "boundary-recovery",
      dependencyPinningCacheKey: "on:pins-a",
      modules: [],
    };
    const fetchModule: typeof fetch = (input, init) => {
      probedUrls.push(String(input));
      cacheModes.push((init as { cache?: RequestCache } | undefined)?.cache);
      return Promise.resolve(
        new Response("Unknown dependency snapshot", { status: 409 }),
      );
    };

    const module = await importClientModule(manifest, reference, "rsc-module", {
      importModule(moduleUrl) {
        importedUrls.push(moduleUrl);
        return Promise.reject(new TypeError("dynamic import failed"));
      },
      recoverSnapshotFailure: (moduleUrl) =>
        recoverFromSnapshotBoundModuleFailure(
          moduleUrl,
          fetchModule,
          () => {
            reloads++;
          },
        ),
    });

    const expectedUrl = "/_veryfront/rsc/module?rel=app%2FCounter.tsx&pins=on%3Apins-a";
    assertEquals(module, null);
    assertEquals(importedUrls, [expectedUrl]);
    assertEquals(probedUrls, [expectedUrl]);
    assertEquals(cacheModes, ["no-store"]);
    assertEquals(reloads, 1);
  });

  it("does not resolve a reference with neither a module URL nor a rel", async () => {
    assertEquals(
      await importClientModule(
        { version: 1, hash: "a", modules: [] },
        { exportName: "default" },
        "rsc-module",
        {},
      ),
      null,
      "a reference with neither moduleUrl nor rel must not resolve",
    );
  });

  it("does not probe an unpinned client-boundary import failure", async () => {
    let probes = 0;
    let reloads = 0;

    const module = await importClientModule(
      {
        version: 1,
        hash: "boundary-unpinned",
        modules: [],
      },
      parseClientRef(
        "/_veryfront/rsc/module?rel=app%2FCounter.tsx#default",
      )!,
      "rsc-module",
      {
        importModule: () => Promise.reject(new TypeError("dynamic import failed")),
        recoverSnapshotFailure: (moduleUrl) =>
          recoverFromSnapshotBoundModuleFailure(
            moduleUrl,
            () => {
              probes++;
              return Promise.resolve(
                new Response("Unknown dependency snapshot", { status: 409 }),
              );
            },
            () => {
              reloads++;
            },
          ),
      },
    );

    assertEquals(module, null);
    assertEquals(probes, 0);
    assertEquals(reloads, 0);
  });
});
