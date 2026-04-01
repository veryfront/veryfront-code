import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildClientModuleUrl,
  determineClientModuleStrategy,
  getHydrationReactImportSpecifiers,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";

describe("rendering/rsc/client-module-strategy", () => {
  it("uses the fs strategy for local or preview environments", () => {
    assertEquals(determineClientModuleStrategy({ isLocalProject: true }), "fs");
    assertEquals(determineClientModuleStrategy({ environment: "preview" }), "fs");
  });

  it("uses the rsc module strategy for remote production environments", () => {
    assertEquals(determineClientModuleStrategy({ environment: "production" }), "rsc-module");
  });

  it("resolves strategy from hydration data without probing endpoints", () => {
    assertEquals(resolveClientModuleStrategy({ clientModuleStrategy: "fs" }), "fs");
    assertEquals(resolveClientModuleStrategy({ clientModuleStrategy: "rsc-module" }), "rsc-module");
  });

  it("builds explicit client module urls for each strategy", () => {
    assertEquals(
      buildClientModuleUrl({
        strategy: "fs",
        rel: "app/page.tsx",
      }),
      "/_veryfront/fs/YXBwL3BhZ2UudHN4.js",
    );
    assertEquals(
      buildClientModuleUrl({
        strategy: "rsc-module",
        rel: "app/page.tsx",
        version: "abc123",
      }),
      "/_veryfront/rsc/module?rel=app%2Fpage.tsx&v=abc123",
    );
  });

  it("reads the document import map instead of relying on failed imports", () => {
    const doc = {
      querySelector: (selector: string) =>
        selector === 'script[type="importmap"]'
          ? {
            textContent:
              '{"imports":{"react":"/react.js","react-dom/client":"/react-dom-client.js"}}',
          }
          : null,
    } as unknown as Document;

    const specifiers = getHydrationReactImportSpecifiers(doc);
    assertEquals(specifiers.react, "react");
    assertEquals(specifiers.reactDomClient, "react-dom/client");
  });
});
