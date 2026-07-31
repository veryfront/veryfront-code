import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
import { fromBase64Url } from "#veryfront/utils/path-utils.ts";

describe("rendering/rsc/client-module-strategy", () => {
  it("uses the fs strategy only when locality and route authority agree", () => {
    assertEquals(
      determineClientModuleStrategy({
        isLocalProject: true,
        allowDevelopmentModuleServing: true,
      }),
      "fs",
    );
  });

  it("fails closed when either route authority or locality is absent", () => {
    assertEquals(determineClientModuleStrategy({ isLocalProject: true }), "rsc-module");
    assertEquals(
      determineClientModuleStrategy({ allowDevelopmentModuleServing: true }),
      "rsc-module",
    );
    assertEquals(
      determineClientModuleStrategy({
        isLocalProject: false,
        allowDevelopmentModuleServing: true,
      }),
      "rsc-module",
    );
  });

  it("resolves strategy from hydration data without probing endpoints", () => {
    assertEquals(resolveClientModuleStrategy({ clientModuleStrategy: "fs" }), "fs");
    assertEquals(resolveClientModuleStrategy({ clientModuleStrategy: "rsc-module" }), "rsc-module");
    assertEquals(resolveClientModuleStrategy({ dev: true }), "rsc-module");
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

  it("preserves Unicode filesystem paths across the client-module transport", () => {
    const path = "app/内容/über/👋.tsx";
    const url = buildClientModuleUrl({ strategy: "fs", rel: path });
    const encoded = url?.slice("/_veryfront/fs/".length, -".js".length) ?? "";

    assertEquals(fromBase64Url(encoded), path);
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

  it("does not resolve inherited or executable release asset entries", () => {
    const inherited = Object.create({
      "app/page.tsx": "/_vf/assets/inherited.js",
    }) as Record<string, string>;

    assertEquals(
      resolveReleaseAssetModuleUrl(inherited, "app/page.tsx"),
      null,
    );
    assertEquals(
      resolveReleaseAssetModuleUrl(
        { "app/page.tsx": "javascript:alert(1)" },
        "app/page.tsx",
      ),
      null,
    );
    assertEquals(
      resolveReleaseAssetModuleUrl(
        { "app/page.tsx": "/\\attacker.example/asset.js" },
        "app/page.tsx",
      ),
      null,
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

  it("uses the server-provided React version when the page has no import map", () => {
    const doc = {
      querySelector: () => null,
    } as unknown as Document;

    const specifiers = getHydrationReactImportSpecifiers(doc, "18.3.1");

    assertEquals(specifiers.react.includes("react@18.3.1"), true);
    assertEquals(specifiers.reactDomClient.includes("react-dom@18.3.1/client"), true);
  });

  it("rejects a malformed import map before choosing React module ownership", () => {
    const doc = {
      querySelector: () => ({
        textContent: '{"imports":{"react":}}',
      }),
    } as unknown as Document;

    assertThrows(
      () => getHydrationReactImportSpecifiers(doc),
      SyntaxError,
      "invalid JSON",
    );
  });

  it("rejects malformed hydration data instead of trusting its TypeScript cast", () => {
    const doc = {
      getElementById: () => ({
        textContent: JSON.stringify({
          pagePath: "app/page.tsx",
          clientModuleStrategy: "arbitrary",
        }),
      }),
    } as unknown as Document;

    assertEquals(readHydrationData(doc), null);
  });

  it("bounds hydration data before parsing", () => {
    const doc = {
      getElementById: () => ({
        textContent: `{"padding":"${"x".repeat(2 * 1024 * 1024)}"}`,
      }),
    } as unknown as Document;

    assertEquals(readHydrationData(doc), null);
  });

  it("rejects malformed snapshot identity in hydration data", () => {
    const doc = {
      getElementById: () => ({
        textContent: JSON.stringify({
          dependencyPinningCacheKey: "on:not-canonical",
        }),
      }),
    } as unknown as Document;

    assertEquals(readHydrationData(doc), null);
  });

  it("verifies an exact canonical hydration snapshot without overwriting it", () => {
    const hydrationElement = {
      textContent: JSON.stringify({
        reactVersion: "19.2.4",
        dependencyPinningCacheKey: "on:1",
      }),
    };
    const doc = {
      getElementById: () => hydrationElement,
    } as unknown as Document;
    const original = hydrationElement.textContent;

    assertEquals(seedHydrationDependencyPins(doc, "on:1"), true);
    assertEquals(seedHydrationDependencyPins(doc, "on:2"), false);
    assertEquals(seedHydrationDependencyPins(doc, "on:not-canonical"), false);
    assertEquals(hydrationElement.textContent, original);
  });

  it("admits and snapshots valid release asset hydration data", () => {
    const doc = {
      getElementById: () => ({
        textContent: JSON.stringify({
          pagePath: "app/page.tsx",
          clientModuleStrategy: "rsc-module",
          releaseAssetModules: {
            "app/page.tsx": "/_vf/assets/page-hash.js",
          },
        }),
      }),
    } as unknown as Document;

    const hydrationData = readHydrationData(doc);
    assertEquals(hydrationData?.releaseAssetModules, {
      "app/page.tsx": "/_vf/assets/page-hash.js",
    });
    assertEquals(Object.isFrozen(hydrationData?.releaseAssetModules), true);
  });
});
