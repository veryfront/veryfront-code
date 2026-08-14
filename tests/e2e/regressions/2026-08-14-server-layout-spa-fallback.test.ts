/**
 * Regression Test: Server-layout routes must fall back to a document
 * navigation silently.
 *
 * Bug: Clicking an internal link to a route whose page data carries
 *   `requiresFullDocumentNavigation` (an App Router "use client" page under a
 *   server-owned layout — the default layout pattern) ran the SPA failure
 *   path: a history entry was pushed, the SPA render threw, the browser
 *   console showed "[Veryfront] SPA navigation failed: Server layout requires
 *   full document navigation", and only then did the router fall back to a
 *   full document navigation. Every internal click on affected apps logged a
 *   console error and duplicated the history entry.
 * Fixed: 2026-08-14
 * Commit: 714822f0a
 *
 * Root Cause:
 *   navigateSPA only discovered the flag inside renderPageFromData, which
 *   throws into the generic error path (console.error + document-navigation
 *   fallback) after history had already been mutated.
 *
 * Reproduction:
 *   Serve the real generated hydration runtime on a document whose link
 *   target answers page data flagged with requiresFullDocumentNavigation,
 *   then click the link in a real browser.
 *
 * Fix:
 *   navigateSPA checks the flag right after page data arrives — before any
 *   history mutation — and hands the route to the browser's document loader
 *   with a debug-level log.
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

const ORIGIN_HTML = `<!doctype html>
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
      <main id="home-page">
        <a id="other-link" href="/other">Other</a>
      </main>
    </div>
    <script id="veryfront-hydration-data" type="application/json">
      {"pagePath":"pages/index.tsx","params":{},"props":{}}
    </script>
    <script type="module" src="/hydration-runtime.js"></script>
  </body>
</html>`;

const OTHER_HTML = `<!doctype html>
<html>
  <body>
    <main id="other-page">Server-layout destination</main>
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

const ROUTER_MODULE = `
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
export default function OriginPage() {
  return null;
}
`;

const FLAGGED_PAGE_DATA = JSON.stringify({
  pagePath: "app/other/page.tsx",
  slug: "other",
  params: {},
  isolatedClientPage: true,
  requiresFullDocumentNavigation: true,
});

function javascript(source: string): Response {
  return new Response(source, {
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

function html(source: string): Response {
  return new Response(source, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe(
  "Regression: server-layout SPA fallback stays silent",
  () => {
    it("document-navigates to a flagged route without console errors or duplicate history", async () => {
      const hydrationModule = generateProdHydrationModule();
      const server = Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        onListen() {},
      }, (request) => {
        const pathname = new URL(request.url).pathname;

        if (pathname === "/") return html(ORIGIN_HTML);
        if (pathname === "/other") return html(OTHER_HTML);
        if (pathname === "/hydration-runtime.js") return javascript(hydrationModule);
        if (pathname === "/react.js") return javascript(REACT_MODULE);
        if (pathname === "/react-dom-client.js") return javascript(REACT_DOM_CLIENT_MODULE);
        if (pathname === "/router.js") return javascript(ROUTER_MODULE);
        if (pathname === "/context.js") return javascript(PAGE_CONTEXT_MODULE);
        if (pathname === "/_veryfront/page-data/other.json") {
          return new Response(FLAGGED_PAGE_DATA, {
            headers: { "content-type": "application/json" },
          });
        }
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

        // The click listener is installed by the same runtime that publishes
        // the router handle; waiting for the handle means interception is on.
        await page.waitForFunction(
          () => Boolean((globalThis as { __veryfrontRouter?: unknown }).__veryfrontRouter),
          undefined,
          { timeout: 10_000 },
        );

        // Sentinel: survives a soft navigation, dies with the document.
        await page.evaluate(() => {
          (globalThis as { __vfDocumentSentinel?: string }).__vfDocumentSentinel = "alive";
        });

        await Promise.all([
          page.waitForURL("**/other"),
          page.click("#other-link"),
        ]);
        await page.waitForSelector("#other-page", { timeout: 10_000 });

        const sentinel = await page.evaluate(() =>
          (globalThis as { __vfDocumentSentinel?: string }).__vfDocumentSentinel ?? null
        );
        assertEquals(
          sentinel,
          null,
          "a flagged route must be reached via a full document navigation",
        );

        const spaFailures = getBrowserDiagnosticMessages(diagnostics)
          .filter((message) => message.includes("SPA navigation failed"));
        assertEquals(
          spaFailures,
          [],
          "the designed document-navigation fallback must not log a console error",
        );

        // The document loader owns the history entry: a single back must land
        // on the origin page (the old pushState-then-navigate flow duplicated
        // the entry).
        await Promise.all([
          page.waitForURL(`http://127.0.0.1:${port}/`),
          page.goBack(),
        ]);
        await page.waitForSelector("#other-link", { timeout: 10_000 });
      } finally {
        await closeChromium(browser);
        await server.shutdown();
      }
    });
  },
);
