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

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureBrowserDiagnostics,
  closeChromium,
  getBrowserDiagnosticMessages,
  launchChromium,
} from "../../_helpers/playwright.ts";
import { generateProdHydrationModule } from "../../../src/html/hydration-script-builder/prod-scripts.ts";

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
function markHydrated(container, mode) {
  document.documentElement.dataset.hydrated = "yes";
  globalThis.__veryfrontMount = { mode, containerId: container?.id || null };
}
export function createRoot(container) {
  return { render() { markHydrated(container, "createRoot"); } };
}
export function hydrateRoot(container) {
  markHydrated(container, "hydrateRoot");
  return { render() { markHydrated(container, "hydrateRoot"); } };
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

const RELEASE_ASSET_HASH = "a".repeat(64);
const RELEASE_ASSET_URL = `/_vf/assets/${RELEASE_ASSET_HASH}.js`;
const APP_ROUTER_RELEASE_HYDRATION_DATA = JSON.stringify({
  pagePath: "app/page.tsx",
  appRouterRoot: "app",
  clientModuleStrategy: "rsc-module",
  isolatedClientPage: true,
  params: {},
  props: {},
  layouts: [{ kind: "tsx", path: "app/layout.tsx" }],
  releaseAssetModules: {
    "app/page.tsx": RELEASE_ASSET_URL,
  },
});
const APP_ROUTER_RELEASE_HTML = `<!doctype html>
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
    <div id="root">
      <section id="server-layout">
        Server-owned layout
        <div id="veryfront-page-island">Server page island</div>
      </section>
    </div>
    <script id="veryfront-hydration-data" type="application/json">
      ${APP_ROUTER_RELEASE_HYDRATION_DATA}
    </script>
    <script type="module" src="/hydration-runtime.js"></script>
  </body>
</html>`;

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

    it("keeps App Router island ownership with a partial release map", async () => {
      const hydrationModule = generateProdHydrationModule();
      const rscModuleRequests: Array<string | null> = [];
      const server = Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen() {},
      }, (request) => {
        const url = new URL(request.url);
        const pathname = url.pathname;

        if (pathname === "/") {
          return new Response(APP_ROUTER_RELEASE_HTML, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        if (pathname === "/hydration-runtime.js") return javascript(hydrationModule);
        if (pathname === "/react.js") return javascript(REACT_MODULE);
        if (pathname === "/react-dom-client.js") return javascript(REACT_DOM_CLIENT_MODULE);
        if (pathname === "/legacy-router.js") return javascript(LEGACY_ROUTER_MODULE);
        if (pathname === "/context.js") return javascript(PAGE_CONTEXT_MODULE);
        if (pathname === RELEASE_ASSET_URL) return javascript(PAGE_MODULE);
        if (pathname === "/_veryfront/rsc/module") {
          rscModuleRequests.push(url.searchParams.get("rel"));
          return javascript(PAGE_MODULE);
        }

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
        assertEquals(
          await page.evaluate(() =>
            Reflect.get(globalThis, "__veryfrontMount") as {
              mode: string;
              containerId: string | null;
            }
          ),
          {
            mode: "createRoot",
            containerId: "veryfront-page-island",
          },
        );
        assertEquals(await page.locator("#server-layout").count(), 1);
        assertEquals(rscModuleRequests, ["app/layout.tsx"]);
      } finally {
        await closeChromium(browser);
        await server.shutdown();
        await server.finished;
      }
    });
  },
);
