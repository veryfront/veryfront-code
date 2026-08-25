import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendClientModuleDependencyPins,
  buildClientModuleUrl,
  buildRSCActionUrl,
  buildRSCTransportHeaders,
  determineClientModuleStrategy,
  getHydrationReactImportSpecifiers,
  readHydrationData,
  resolveClientModuleStrategy,
  resolveReleaseAssetModuleUrl,
  seedHydrationDependencyPins,
} from "./client-module-strategy.ts";
import { getReactCDNUrl, getReactDOMClientCDNUrl } from "#veryfront/utils/constants/cdn.ts";

describe("rendering/rsc/client-module-strategy", () => {
  it("accepts only the unique server-owned hydration location", () => {
    const genuine = {
      id: "veryfront-hydration-data",
      tagName: "SCRIPT",
      textContent: '{"clientModuleStrategy":"rsc-module"}',
      getAttribute: (name: string) => name === "type" ? "application/json" : null,
    };
    const document = {
      body: { firstElementChild: genuine },
      querySelectorAll: () => [genuine],
    } as unknown as Document;

    assertEquals(readHydrationData(document), { clientModuleStrategy: "rsc-module" });
    assertEquals(seedHydrationDependencyPins(document, "on:snapshot-a"), true);
    assertEquals(JSON.parse(genuine.textContent).dependencyPinningCacheKey, "on:snapshot-a");

    const legacyBody = { firstElementChild: { id: "root" } };
    const legacy = {
      ...genuine,
      textContent: '{"clientModuleStrategy":"rsc-module"}',
      parentElement: legacyBody,
    };
    const nestedForgery = {
      ...genuine,
      textContent: '{"clientModuleStrategy":"fs"}',
      parentElement: { id: "root" },
    };
    const legacyDocument = {
      body: legacyBody,
      querySelectorAll: () => [legacy],
    } as unknown as Document;
    assertEquals(readHydrationData(legacyDocument), {
      clientModuleStrategy: "rsc-module",
    });

    const nestedDuplicate = {
      body: legacyBody,
      querySelectorAll: () => [nestedForgery, legacy],
    } as unknown as Document;
    assertEquals(readHydrationData(nestedDuplicate), null);

    const forged = {
      ...genuine,
      textContent: '{"clientModuleStrategy":"fs"}',
      parentElement: document.body,
    };
    const ambiguous = {
      body: document.body,
      querySelectorAll: () => [genuine, forged],
    } as unknown as Document;
    assertEquals(readHydrationData(ambiguous), null);
    assertEquals(seedHydrationDependencyPins(ambiguous, "on:snapshot-b"), false);
  });

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
    assertEquals(
      resolveClientModuleStrategy({ dev: true }),
      "fs",
      "dev hydration data falls back to the fs strategy",
    );
    assertEquals(
      resolveClientModuleStrategy({}),
      "rsc-module",
      "a payload without dev or an explicit strategy must use rsc-module",
    );
    assertEquals(
      resolveClientModuleStrategy(null),
      "rsc-module",
      "unparseable hydration data must not select the dev-only fs endpoint",
    );
  });

  it("builds explicit client module urls for each strategy", () => {
    assertEquals(
      buildClientModuleUrl({
        strategy: "fs",
        rel: "app/page.tsx",
        version: "abc123",
        dependencyPinningCacheKey: "on:pins-a",
      }),
      "/_veryfront/fs/YXBwL3BhZ2UudHN4.js?v=abc123&pins=on%3Apins-a",
    );
    assertEquals(
      buildClientModuleUrl({
        strategy: "rsc-module",
        rel: "app/page.tsx",
        version: "abc123",
        dependencyPinningCacheKey: "off",
      }),
      "/_veryfront/rsc/module?rel=app%2Fpage.tsx&v=abc123",
    );
    assertEquals(
      buildClientModuleUrl({
        strategy: "rsc-module",
        rel: "app/page.tsx",
        version: "abc123",
        dependencyPinningCacheKey: "on:pins-a",
      }),
      "/_veryfront/rsc/module?rel=app%2Fpage.tsx&v=abc123&pins=on%3Apins-a",
    );
  });

  it("preserves URL bytes unless dependency pinning is explicitly on", () => {
    const url = "/_veryfront/rsc/module?label=hello%20world&pins=application-value#entry";

    assertEquals(appendClientModuleDependencyPins(url), url);
    assertEquals(appendClientModuleDependencyPins(url, "off"), url);
    assertEquals(appendClientModuleDependencyPins(url, "malformed"), url);
    assertEquals(
      appendClientModuleDependencyPins(url, "on:snapshot-a"),
      "/_veryfront/rsc/module?label=hello+world&pins=on%3Asnapshot-a#entry",
    );
  });

  it("binds fetch-capable Server Actions with a header, not application query state", () => {
    assertEquals(
      buildRSCActionUrl({
        dependencyPinningCacheKey: "on:pins-a",
      }),
      "/_veryfront/rsc/action",
    );
    assertEquals(
      buildRSCTransportHeaders({
        dependencyPinningCacheKey: "on:pins-a",
      }),
      { "x-veryfront-dependency-pins": "on:pins-a" },
    );
    assertEquals(
      buildRSCActionUrl({
        dependencyPinningCacheKey: "off",
      }),
      "/_veryfront/rsc/action",
    );
    assertEquals(buildRSCActionUrl(null), "/_veryfront/rsc/action");
    assertEquals(buildRSCTransportHeaders({ dependencyPinningCacheKey: "off" }), {});
    assertEquals(buildRSCTransportHeaders(null), {});
  });

  it("prefers release asset urls for remote client modules", () => {
    assertEquals(
      buildClientModuleUrl({
        strategy: "rsc-module",
        rel: "app/page.tsx",
        releaseAssetModules: {
          "app/page.tsx": "/_vf/assets/page-hash.js",
        },
      }),
      "/_vf/assets/page-hash.js",
    );
  });

  it("resolves release asset urls from module endpoint paths", () => {
    assertEquals(
      resolveReleaseAssetModuleUrl(
        { "app/page.tsx": "/_vf/assets/page-hash.js" },
        "/_vf_modules/app/page.js",
      ),
      "/_vf/assets/page-hash.js",
    );
  });

  it("does not fabricate extension variants for source paths that already have one", () => {
    assertEquals(
      resolveReleaseAssetModuleUrl(
        { "app/page.tsx.tsx": "/_vf/assets/bad-path.js" },
        "app/page.tsx",
      ),
      null,
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

  it("resolves each React specifier against its own import-map entry", () => {
    const docWithImports = (imports: Record<string, string>): Document =>
      ({
        querySelector: (selector: string) =>
          selector === 'script[type="importmap"]'
            ? { textContent: JSON.stringify({ imports }) }
            : null,
      }) as unknown as Document;

    const reactOnly = getHydrationReactImportSpecifiers(
      docWithImports({ react: "/react.js" }),
      "18.3.1",
    );
    assertEquals(reactOnly.react, "react", "an owned react specifier stays bare");
    assertEquals(
      reactOnly.reactDomClient,
      getReactDOMClientCDNUrl("18.3.1"),
      "an unowned react-dom/client falls back to the CDN URL",
    );

    const clientOnly = getHydrationReactImportSpecifiers(
      docWithImports({ "react-dom/client": "/react-dom-client.js" }),
      "18.3.1",
    );
    assertEquals(
      clientOnly.reactDomClient,
      "react-dom/client",
      "an owned react-dom/client specifier stays bare",
    );
    assertEquals(
      clientOnly.react,
      getReactCDNUrl("18.3.1"),
      "an unowned react falls back to the CDN URL",
    );
  });

  it("uses the server-provided React version when the page has no import map", () => {
    const doc = {
      querySelector: () => null,
    } as unknown as Document;

    const specifiers = getHydrationReactImportSpecifiers(doc, "18.3.1");

    assertEquals(specifiers.react.includes("react@18.3.1"), true);
    assertEquals(specifiers.reactDomClient.includes("react-dom@18.3.1/client"), true);
  });
});
