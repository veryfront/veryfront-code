import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildClientModuleUrl,
  determineClientModuleStrategy,
  getHydrationReactImportSpecifiers,
  resolveClientModuleStrategy,
} from "./client-module-strategy.ts";

describe("rendering/rsc/client-module-strategy", () => {
  it("uses the fs strategy only for local projects", () => {
    // Only the server-trusted `isLocalProject` signal unlocks the dev-only
    // `/_veryfront/fs/` handler. Preview mode (which can be reached via
    // trusted proxy headers) no longer implies dev-file availability — the
    // fs handler was narrowed to local projects under VULN-SRV-1/2.
    assertEquals(determineClientModuleStrategy({ isLocalProject: true }), "fs");
    assertEquals(
      determineClientModuleStrategy({ isLocalProject: true, environment: "production" }),
      "fs",
    );
  });

  it("uses the rsc module strategy for remote environments", () => {
    assertEquals(determineClientModuleStrategy({ environment: "production" }), "rsc-module");
    assertEquals(determineClientModuleStrategy({ environment: "preview" }), "rsc-module");
    assertEquals(
      determineClientModuleStrategy({ isLocalProject: false, environment: "preview" }),
      "rsc-module",
    );
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
