#!/usr/bin/env -S deno test --allow-all

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
          "veryfront/router": "/router.js",
          "veryfront/context": "/context.js"
        }
      }
    </script>
  </head>
  <body>
    <div id="root">
      <main id="server-layout">
        <div id="veryfront-page-island">Server page</div>
      </main>
    </div>
    <script id="veryfront-hydration-data" type="application/json">
      {
        "pagePath": "app/page.tsx",
        "appRouterRoot": "app",
        "clientModuleStrategy": "rsc-module",
        "isolatedClientPage": true,
        "releaseAssetModules": {
          "app/page.tsx": "/page.js"
        },
        "layouts": [],
        "params": {},
        "props": {}
      }
    </script>
    <script type="module" src="/hydration-runtime.js"></script>
  </body>
</html>`;

const REACT_MODULE = `
export function createElement(type, props, ...children) {
  return { type, props: props || {}, children };
}
export const Children = { toArray(value) { return Array.isArray(value) ? value : [value]; } };
export function isValidElement(value) { return Boolean(value && value.type); }
export class Component {}
`;

const REACT_DOM_CLIENT_MODULE = `
function mount(container) {
  document.documentElement.dataset.hydratedRoot = container.id;
  container.innerHTML = '<div id="client-page">Client page</div>';
  return { render() { mount(container); } };
}
export function createRoot(container) {
  return { render() { mount(container); } };
}
export function hydrateRoot(container) {
  return mount(container);
}
`;

const ROUTER_MODULE = `
const store = {
  subscribe() { return () => {}; },
  getHref() { return location.pathname + location.search + location.hash; },
  notify() {},
  navigate() { return Promise.resolve(); },
  setNavigator() {}
};
export function RouterProvider({ children }) { return children; }
export function useRouter() { return {}; }
export function getNavigationStore() { return store; }
`;

const PAGE_CONTEXT_MODULE = `
export function PageContextProvider({ children }) { return children; }
`;

const PAGE_MODULE = `
export default function Page() { return null; }
`;

function javascript(source: string): Response {
  return new Response(source, {
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

describe("Regression: release asset hydration preserves server layouts", () => {
  it("mounts an isolated client page inside the server-owned page island", async () => {
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
      if (pathname === "/router.js") return javascript(ROUTER_MODULE);
      if (pathname === "/context.js") return javascript(PAGE_CONTEXT_MODULE);
      if (pathname === "/page.js") return javascript(PAGE_MODULE);

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
      await page.waitForFunction(
        () => document.documentElement.dataset.hydratedRoot !== undefined,
        undefined,
        { timeout: 5_000 },
      );

      assertEquals(
        await page.evaluate(() => document.documentElement.dataset.hydratedRoot),
        "veryfront-page-island",
      );
      assertEquals(await page.locator("#server-layout").count(), 1);
      assertEquals(await page.locator("#client-page").textContent(), "Client page");
      assertEquals(getBrowserDiagnosticMessages(diagnostics), []);
    } finally {
      await closeChromium(browser);
      await server.shutdown();
      await server.finished;
    }
  });
});
