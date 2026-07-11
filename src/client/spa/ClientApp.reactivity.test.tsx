import { JSDOM } from "npm:jsdom@28.0.0";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { ClientApp, type PageDataResponse } from "./ClientApp.tsx";
import { clearComponentCache, loadComponent } from "./component-loader.ts";
import { getNavigationStore } from "../../rendering/client/navigation-store.ts";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");
const testGlobal = globalThis as typeof globalThis & {
  MODULE_SERVER_URL?: string;
  __VERYFRONT_SPA_NAVIGATE__?: (data: PageDataResponse) => Promise<void>;
};

async function writeModule(tempDir: string, relativePath: string, source: string): Promise<void> {
  const filePath = `${tempDir}/${relativePath}`;
  await mkdir(filePath.slice(0, filePath.lastIndexOf("/")), { recursive: true });
  await writeTextFile(filePath, source);
}

function installDom(url: string): () => void {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const w = dom.window;
  const keys = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "Element",
    "HTMLElement",
    "history",
    "location",
  ] as const;
  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    navigator: w.navigator,
    self: w,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    history: w.history,
    location: w.location,
  });
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
  return () => {
    Object.assign(globalThis, previous);
    delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
    dom.window.close();
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("client/spa/ClientApp (reactive)", () => {
  it("a page rendered through ClientApp gets a reactive useRouter().query", async () => {
    await withTempDir(async (tempDir) => {
      // A page component (loaded the same way the SPA path loads it) that reads
      // the router. Its bare imports resolve through the app's import map.
      await writeModule(
        tempDir,
        "pages/dash.js",
        `import React from "react";
         import { useRouter } from "veryfront/router";
         export default function Page() {
           const r = useRouter();
           return React.createElement("span", null, "tab:" + (r.query.tab || "none"));
         }`,
      );

      const restore = installDom("https://example.com/dashboard?tab=a");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await loadComponent("pages/dash.tsx"); // populate the cache so ClientApp renders it synchronously

        const initialData: PageDataResponse = {
          slug: "/dashboard",
          pagePath: "pages/dash.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        assertStringIncludes(rootElement.textContent ?? "", "tab:a");

        // Any navigation source notifies the same store; ClientApp's
        // RouterProvider re-renders the page — same reactivity as the RSC path.
        globalThis.history.pushState({}, "", "/dashboard?tab=b");
        getNavigationStore().notify();
        await tick();

        assertStringIncludes(rootElement.textContent ?? "", "tab:b");

        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-reactive-" });
  });

  it("does not let a slower stale navigation overwrite a newer page", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/initial.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "initial"); }`,
      );
      await writeModule(
        tempDir,
        "pages/slow.js",
        `import React from "react";
         await new Promise((resolve) => setTimeout(resolve, 40));
         export default function Page() { return React.createElement("span", null, "slow"); }`,
      );
      await writeModule(
        tempDir,
        "pages/fast.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "fast"); }`,
      );

      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await loadComponent("pages/initial.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: { title: "Initial" },
          props: {},
          params: {},
          layoutProps: {},
        };
        const pageData = (slug: string, title: string): PageDataResponse => ({
          ...initialData,
          slug: `/${slug}`,
          pagePath: `pages/${slug}.tsx`,
          frontmatter: { title },
        });

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();
        const navigate = testGlobal.__VERYFRONT_SPA_NAVIGATE__;
        assertEquals(typeof navigate, "function");

        const slowNavigation = navigate!(pageData("slow", "Slow"));
        const fastNavigation = navigate!(pageData("fast", "Fast"));
        await Promise.all([slowNavigation, fastNavigation]);
        await tick();

        assertStringIncludes(rootElement.textContent ?? "", "fast");
        assertEquals(document.title, "Fast");

        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-race-" });
  });

  it("does not let the initial component load overwrite a completed navigation", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/initial.js",
        `import React from "react";
         await new Promise((resolve) => setTimeout(resolve, 40));
         export default function Page() { return React.createElement("span", null, "initial"); }`,
      );
      await writeModule(
        tempDir,
        "pages/fast.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "fast"); }`,
      );

      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: { title: "Initial" },
          props: {},
          params: {},
          layoutProps: {},
        };
        const fastData: PageDataResponse = {
          ...initialData,
          slug: "/fast",
          pagePath: "pages/fast.tsx",
          frontmatter: { title: "Fast" },
        };

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();
        const navigate = testGlobal.__VERYFRONT_SPA_NAVIGATE__;
        assertEquals(typeof navigate, "function");

        await navigate!(fastData);
        await new Promise((resolve) => setTimeout(resolve, 50));

        assertStringIncludes(rootElement.textContent ?? "", "fast");
        assertEquals(document.title, "Fast");

        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-initial-race-" });
  });
});
