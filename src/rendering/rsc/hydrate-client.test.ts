import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseClientRef,
  readClientBoundaryChildren,
  readClientBoundaryProps,
  resolveClientBoundaryModuleUrl,
  selectTopLevelClientBoundaries,
  shouldHydrateClientBoundary,
} from "./hydrate-client.ts";
import type { HydrationManifest } from "./hydration-manifest.ts";

describe("rendering/rsc/hydrate-client", () => {
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

  it("rejects traversal and control characters in logical client references", () => {
    assertEquals(parseClientRef("/app/../secrets.ts#default"), null);
    assertEquals(parseClientRef("/app/client\n.ts#default"), null);
    assertEquals(parseClientRef("/_veryfront/rsc/module?rel=ok%0a.ts#default"), null);
    assertEquals(parseClientRef("/_veryfront/../admin.js#default"), null);
    assertEquals(parseClientRef("/_veryfront/%2e%2e/admin.js#default"), null);
  });

  it("reads the serialized props emitted for a client boundary", () => {
    const element = {
      dataset: { rscProps: '{"label":"Save","count":2}' },
    } as unknown as HTMLElement;

    assertEquals(readClientBoundaryProps(element), { label: "Save", count: 2 });
  });

  it("rejects malformed client boundary props instead of hydrating with empty props", () => {
    const element = {
      dataset: { rscProps: "not-json" },
    } as unknown as HTMLElement;

    assertEquals(readClientBoundaryProps(element), null);
  });

  it("rejects non-object client boundary props instead of hydrating with empty props", () => {
    for (const rscProps of ["null", "[]", '"text"', "42"]) {
      const element = {
        dataset: { rscProps },
      } as unknown as HTMLElement;

      assertEquals(readClientBoundaryProps(element), null);
    }
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

  it("rejects malformed boundary children instead of silently deleting them", () => {
    const element = {
      dataset: { rscChildren: "not-json" },
    } as unknown as HTMLElement;

    assertThrows(
      () => readClientBoundaryChildren(element),
      SyntaxError,
    );
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

  it("rehydrates a boundary when its manifest hash changes", () => {
    const element = {
      dataset: {
        hydrated: "true",
        hydrationHash: "old-hash",
      },
    } as unknown as HTMLElement;

    assertEquals(shouldHydrateClientBoundary(element, "old-hash"), false);
    assertEquals(shouldHydrateClientBoundary(element, "new-hash"), true);
  });

  it("resolves logical refs to local and remote hydration module URLs", () => {
    const reference = parseClientRef("/app/Counter.tsx#default")!;
    const manifest: HydrationManifest = {
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

  it("prefers release asset module URLs for remote client boundaries", () => {
    const reference = parseClientRef("/app/Counter.tsx#default")!;
    const manifest: HydrationManifest = {
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
});
