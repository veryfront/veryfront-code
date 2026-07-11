import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseClientRef,
  readClientBoundaryChildren,
  readClientBoundaryProps,
  resolveClientBoundaryModuleUrl,
  selectTopLevelClientBoundaries,
} from "./hydrate-client.ts";

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

  it("reads the serialized props emitted for a client boundary", () => {
    const element = {
      dataset: { rscProps: '{"label":"Save","count":2}' },
    } as unknown as HTMLElement;

    assertEquals(readClientBoundaryProps(element), { label: "Save", count: 2 });
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
});
