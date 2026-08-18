#!/usr/bin/env -S deno test --allow-all
/**
 * Regression Test: Shared hydration runtime breaks legacy router assets
 *
 * Bug: A current shared hydration runtime statically imported
 *      `getNavigationStore` from a release-pinned `veryfront/router` asset.
 *      Existing releases without that export failed during browser module
 *      linking before hydration could run.
 * Fixed: 2026-07-27
 * Related: https://github.com/veryfront/veryfront-issue-inbox/issues/264
 * Hotfix: https://github.com/veryfront/veryfront-code/pull/3124
 * Artifact selection: https://github.com/veryfront/veryfront-issue-inbox/issues/277
 *
 * Root Cause:
 *   The shared hydration runtime and project release assets are versioned
 *   independently, but the hydration runtime required a new named export.
 *
 * Reproduction:
 *   Serve the latest generated hydration module with a legacy router module
 *   that exports RouterProvider and useRouter, but not getNavigationStore.
 *
 * Fix:
 *   Resolve getNavigationStore through the router module namespace and register
 *   the SPA navigator only when that optional export exists.
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureBrowserDiagnostics,
  closeChromium,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";
import {
  generateProdHydrationModule,
  getProdHydrationModulePath,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReleaseAssetManifestCache,
  getReadyManifestForRenderAsync,
  isReleaseAssetManifestEnabled,
  registerManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { PageRenderer } from "#veryfront/rendering/page-renderer.ts";

const HTML = `<!doctype html>
<html>
  <head>
    <script type="importmap">
      {
        "imports": {
          "react": "/react.js",
          "react-dom/client": "/react-dom-client.js",
          "veryfront/router": "/legacy-router.js",
          "veryfront/context": "/context.js"
        }
      }
    </script>
  </head>
  <body>
    <div id="root">Existing release content</div>
    <script id="veryfront-hydration-data" type="application/json">
      {"pagePath":"pages/index.tsx","params":{},"props":{}}
    </script>
    <script type="module" src="/hydration-runtime.js"></script>
  </body>
</html>`;

const REACT_MODULE = `
export function createElement(type, props, ...children) {
  return { type, props: props || {}, children };
}
`;

const REACT_DOM_CLIENT_MODULE = `
function markHydrated() {
  document.documentElement.dataset.hydrated = "yes";
  return { render: markHydrated };
}
export function createRoot() {
  return { render: markHydrated };
}
export function hydrateRoot() {
  markHydrated();
  return { render: markHydrated };
}
`;

const LEGACY_ROUTER_MODULE = `
const navigationStoreKey = Symbol.for("veryfront.navigation.store.v1");
const navigationState = { navigator: null };
const listeners = new Set();
const navigationStore = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getHref() {
    return location.pathname + location.search + location.hash;
  },
  notify() {
    for (const listener of listeners) listener();
  },
  navigate(href, options) {
    if (navigationState.navigator) return navigationState.navigator(href, options);
    location.assign(href);
    return Promise.resolve();
  },
  setNavigator(navigator) {
    navigationState.navigator = navigator;
  }
};
globalThis[navigationStoreKey] = navigationStore;
globalThis.__legacyRouterNavigationState = navigationState;

export function RouterProvider({ children }) {
  return children;
}
export function useRouter() {
  return {};
}
`;

const PAGE_CONTEXT_MODULE = `
export function PageContextProvider({ children }) {
  return children;
}
`;

const PAGE_MODULE = `
export default function ExistingReleasePage() {
  return null;
}
`;

const AGED_RELEASE_HYDRATION_MODULE = `
document.documentElement.dataset.hydrationArtifact = "aged-release";
document.documentElement.dataset.hydrated = "yes";
`;

function javascript(source: string): Response {
  return new Response(source, {
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

async function waitForHydration(
  page: import("npm:playwright@1.60.0").Page,
  diagnostics: ReturnType<typeof captureBrowserDiagnostics>,
): Promise<void> {
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "yes",
      undefined,
      { timeout: 5_000 },
    );
  } catch (error) {
    const missingExport = getBrowserDiagnosticMessages(diagnostics).find((message) =>
      message.includes("does not provide an export named 'getNavigationStore'")
    );
    if (missingExport) {
      throw new Error(`Hydration module linking failed: ${missingExport}`, { cause: error });
    }
    throw error;
  }
}

describe(
  "Regression: shared hydration runtime supports legacy router release assets",
  () => {
    it("hydrates without requiring getNavigationStore", async () => {
      const hydrationModule = generateProdHydrationModule();
      const server = Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen() {},
      }, (request) => {
        const pathname = new URL(request.url).pathname;

        if (pathname === "/") {
          return new Response(HTML, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        if (pathname === "/hydration-runtime.js") return javascript(hydrationModule);
        if (pathname === "/react.js") return javascript(REACT_MODULE);
        if (pathname === "/react-dom-client.js") return javascript(REACT_DOM_CLIENT_MODULE);
        if (pathname === "/legacy-router.js") return javascript(LEGACY_ROUTER_MODULE);
        if (pathname === "/context.js") return javascript(PAGE_CONTEXT_MODULE);
        if (pathname.startsWith("/_vf_modules/")) return javascript(PAGE_MODULE);

        return new Response("Not found", { status: 404 });
      });
      const browser = await launchChromium();

      try {
        if (!browser) return;

        const page = await browser.newPage();
        const diagnostics = captureBrowserDiagnostics(page);
        const { port } = server.addr as Deno.NetAddr;
        const response = await page.goto(`http://127.0.0.1:${port}/`);

        assertEquals(response?.status(), 200);
        await waitForHydration(page, diagnostics);

        const messages = getBrowserDiagnosticMessages(diagnostics);
        assertEquals(
          messages.some((message) =>
            message.includes(
              "does not provide an export named 'getNavigationStore'",
            )
          ),
          false,
          messages.join("\n"),
        );
        assertEquals(
          await page.locator("#root").textContent(),
          "Existing release content",
        );
        assertEquals(
          await page.evaluate(() => {
            const state = Reflect.get(globalThis, "__legacyRouterNavigationState") as
              | { navigator?: unknown }
              | undefined;
            return typeof state?.navigator === "function";
          }),
          true,
        );
      } finally {
        await closeChromium(browser);
        await server.shutdown();
        await server.finished;
      }
    });

    it("loads the aged release runtime instead of the current serving runtime", async () => {
      const agedRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";
      const projectDir = await Deno.makeTempDir({ prefix: "vf-aged-release-browser-" });
      let server: ReturnType<typeof Deno.serve> | undefined;
      let browser: Awaited<ReturnType<typeof launchChromium>> = null;

      try {
        await Deno.mkdir(`${projectDir}/dist/_veryfront`, { recursive: true });
        await Deno.writeTextFile(`${projectDir}/dist${agedRuntimePath}`, "export {};");
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(pagePath, `export default "<main>Aged release</main>";`);

        const adapter = { fs: createFileSystem() } as unknown as RuntimeAdapter;
        const renderer = new PageRenderer({
          projectDir,
          mode: "production",
          config: {},
          adapter,
          componentRegistry: {} as never,
          compileMDX: () => Promise.reject(new Error("not used for script pages")),
        });
        const renderResult = await renderer.preparePageBundles(
          { entity: { path: pagePath, frontmatter: {} } } as never,
          "aged-release",
          undefined,
          { releaseId: "release-aged" },
        );
        const html = renderResult.scriptResult?.html;
        if (!html) throw new Error("Expected the script page renderer to return HTML");
        assertStringIncludes(html, agedRuntimePath);
        assertEquals(html.includes(getProdHydrationModulePath()), false);

        let currentRuntimeRequests = 0;
        server = Deno.serve({
          hostname: "127.0.0.1",
          port: 0,
          onListen() {},
        }, (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/") {
            return new Response(html, {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          if (pathname === agedRuntimePath) return javascript(AGED_RELEASE_HYDRATION_MODULE);
          if (pathname === getProdHydrationModulePath()) {
            currentRuntimeRequests += 1;
            return new Response("Wrong runtime", { status: 500 });
          }
          if (pathname.endsWith(".js")) return javascript("export default {};");
          return new Response(null, { status: 204 });
        });
        browser = await launchChromium();
        if (!browser) return;

        const page = await browser.newPage();
        const diagnostics = captureBrowserDiagnostics(page);
        const { port } = server.addr as Deno.NetAddr;
        const response = await page.goto(`http://127.0.0.1:${port}/`);

        assertEquals(response?.status(), 200);
        await waitForHydration(page, diagnostics);
        assertEquals(
          await page.evaluate(() => document.documentElement.dataset.hydrationArtifact),
          "aged-release",
        );
        assertEquals(currentRuntimeRequests, 0);
        assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
      } finally {
        await closeChromium(browser);
        if (server) {
          await server.shutdown();
          await server.finished;
        }
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("loads the serving runtime for a pre-contract release without build assets", async () => {
      const releaseId = "release-pre-runtime-contract";
      const projectDir = await Deno.makeTempDir({ prefix: "vf-pre-runtime-release-browser-" });
      const previousManifestFlag = getEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
      let unregisterManifest = () => {};
      let server: ReturnType<typeof Deno.serve> | undefined;
      let browser: Awaited<ReturnType<typeof launchChromium>> = null;

      try {
        setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
        clearReleaseAssetManifestCache();
        unregisterManifest = registerManifestFetcherForRelease(
          releaseId,
          () =>
            Promise.resolve({
              state: "ready",
              manifest_version: 1,
              manifest: {
                schemaVersion: 2,
                projectId: "aged-release-project",
                releaseId,
                releaseVersion: 1,
                manifestVersion: 1,
                builderVersion: "0.1.1220",
                sourceContentHash: "a".repeat(64),
                createdAt: "2026-08-18T00:00:00.000Z",
                assetBasePath: "/_vf/assets",
                modules: {},
                css: [],
                routes: {},
                dependencyMode: "source",
                dependencies: {},
              },
            }),
        );
        assertEquals(isReleaseAssetManifestEnabled(), true);
        assertEquals(
          (await getReadyManifestForRenderAsync(releaseId))?.builderVersion,
          "0.1.1220",
        );
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(pagePath, `export default "<main>Pre-contract release</main>";`);

        const adapter = { fs: createFileSystem() } as unknown as RuntimeAdapter;
        const renderer = new PageRenderer({
          projectDir,
          mode: "production",
          config: {},
          adapter,
          componentRegistry: {} as never,
          compileMDX: () => Promise.reject(new Error("not used for script pages")),
        });
        const renderResult = await renderer.preparePageBundles(
          { entity: { path: pagePath, frontmatter: {} } } as never,
          "pre-contract-release",
          undefined,
          { releaseId },
        );
        const html = renderResult.scriptResult?.html;
        if (!html) throw new Error("Expected the script page renderer to return HTML");

        const servingRuntimePath = getProdHydrationModulePath();
        assertStringIncludes(html, servingRuntimePath);

        server = Deno.serve({
          hostname: "127.0.0.1",
          port: 0,
          onListen() {},
        }, (request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/") {
            return new Response(html, {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          if (pathname === servingRuntimePath) return javascript(AGED_RELEASE_HYDRATION_MODULE);
          if (pathname.endsWith(".js")) return javascript("export default {};");
          return new Response(null, { status: 204 });
        });
        browser = await launchChromium();
        if (!browser) return;

        const page = await browser.newPage();
        const diagnostics = captureBrowserDiagnostics(page);
        const { port } = server.addr as Deno.NetAddr;
        const response = await page.goto(`http://127.0.0.1:${port}/`);

        assertEquals(response?.status(), 200);
        await waitForHydration(page, diagnostics);
        assertEquals(
          await page.evaluate(() => document.documentElement.dataset.hydrationArtifact),
          "aged-release",
        );
        assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
      } finally {
        await closeChromium(browser);
        if (server) {
          await server.shutdown();
          await server.finished;
        }
        unregisterManifest();
        clearReleaseAssetManifestCache();
        if (previousManifestFlag === undefined) {
          deleteEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
        } else {
          setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, previousManifestFlag);
        }
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  },
);
