import { JSDOM } from "npm:jsdom@28.0.0";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { ClientApp, type PageDataResponse } from "./ClientApp.tsx";
import { clearComponentCache, loadComponent } from "./component-loader.ts";
import { getNavigationStore } from "../../rendering/client/navigation-store.ts";

const NAVIGATION_STORE_KEY = Symbol.for("veryfront.navigation.store.v1");
const testGlobal = globalThis as typeof globalThis & {
  MODULE_SERVER_URL?: string;
  __VERYFRONT_SPA_NAVIGATE__?: (data: PageDataResponse) => Promise<void>;
  __veryfrontSetReleaseAssetModules?: (value: Record<string, string> | null) => void;
  __veryfrontSetReleaseId?: (value: string | null) => void;
  veryFrontRouter?: {
    registerNavigationHandler?: (handler: (data: PageDataResponse) => Promise<void>) => void;
    unregisterNavigationHandler?: (handler: (data: PageDataResponse) => Promise<void>) => void;
  };
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
        // RouterProvider re-renders the page with the same reactivity as the RSC path.
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

  it("uses an immutable snapshot throughout an asynchronous navigation", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/initial-snapshot.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "initial"); }',
      );
      await writeModule(
        tempDir,
        "pages/snapshot.js",
        `import React from "react";
         await new Promise((resolve) => setTimeout(resolve, 25));
         export default function Page(props) { return React.createElement("span", null, props.label); }`,
      );

      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await loadComponent("pages/initial-snapshot.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial-snapshot.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: { title: "Initial" },
          props: {},
          params: {},
          layoutProps: {},
        };
        const targetData: PageDataResponse = {
          ...initialData,
          slug: "/snapshot",
          pagePath: "pages/snapshot.tsx",
          frontmatter: { title: "Snapshot" },
          props: { label: "snapshot" },
        };
        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();

        const navigation = testGlobal.__VERYFRONT_SPA_NAVIGATE__!(targetData);
        targetData.slug = "/mutated";
        targetData.pagePath = "pages/mutated.tsx";
        targetData.frontmatter.title = "Mutated";
        targetData.props.label = "mutated";
        await navigation;
        await tick();

        assertStringIncludes(rootElement.textContent ?? "", "snapshot");
        assertEquals((rootElement.textContent ?? "").includes("mutated"), false);
        assertEquals(document.title, "Snapshot");
        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-snapshot-" });
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

  it("shows a safe error when the initial page component cannot load", async () => {
    await withTempDir(async (tempDir) => {
      const restore = installDom("https://example.com/missing");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};

      try {
        const initialData: PageDataResponse = {
          slug: "/missing",
          pagePath: "pages/private-machine-path.tsx",
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
        await new Promise((resolve) => setTimeout(resolve, 25));

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertEquals((rootElement.textContent ?? "").includes("private-machine-path"), false);

        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-missing-" });
  });

  it("keeps an initial release-context failure visible", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/release-context.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "page"); }',
      );
      const restore = installDom("https://example.com/release-context");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      testGlobal.__veryfrontSetReleaseAssetModules = () => {
        throw new TypeError("private release detail");
      };

      try {
        await loadComponent("pages/release-context.tsx");
        const initialData: PageDataResponse = {
          slug: "/release-context",
          pagePath: "pages/release-context.tsx",
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
        await tick();

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertEquals((rootElement.textContent ?? "").includes("private release detail"), false);
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        delete testGlobal.__veryfrontSetReleaseAssetModules;
        restore();
      }
    }, { prefix: "vf-client-release-context-error-" });
  });

  it("does not replace the browser history methods", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/history.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "history"); }',
      );
      const restore = installDom("https://example.com/history");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();

      try {
        await loadComponent("pages/history.tsx");
        const initialData: PageDataResponse = {
          slug: "/history",
          pagePath: "pages/history.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };
        const originalPushState = globalThis.history.pushState;
        const originalReplaceState = globalThis.history.replaceState;
        const root = createRoot(document.getElementById("root")!);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();

        assertEquals(globalThis.history.pushState, originalPushState);
        assertEquals(globalThis.history.replaceState, originalReplaceState);

        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-history-" });
  });

  it("shows a safe error when a layout component cannot load", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/layout-error.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "page"); }',
      );
      const restore = installDom("https://example.com/layout-error");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};

      try {
        await loadComponent("pages/layout-error.tsx");
        const initialData: PageDataResponse = {
          slug: "/layout-error",
          pagePath: "pages/layout-error.tsx",
          pageType: "tsx",
          layouts: [{ kind: "tsx", path: "layouts/private-layout.tsx" }],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };
        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await new Promise((resolve) => setTimeout(resolve, 25));

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertEquals((rootElement.textContent ?? "").includes("private-layout"), false);

        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-layout-missing-" });
  });

  it("updates and clears route CSS during SPA navigation", async () => {
    await withTempDir(async (tempDir) => {
      for (const name of ["initial", "styled", "broken", "plain"]) {
        await writeModule(
          tempDir,
          `pages/${name}.js`,
          `import React from "react"; export default function Page() { return React.createElement("span", null, "${name}"); }`,
        );
      }
      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));

      try {
        await loadComponent("pages/initial.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };
        const root = createRoot(document.getElementById("root")!);
        const description = document.createElement("meta");
        description.setAttribute("name", "description");
        document.head.appendChild(description);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();
        const navigate = testGlobal.__VERYFRONT_SPA_NAVIGATE__;
        assertEquals(typeof navigate, "function");

        await navigate!({
          ...initialData,
          slug: "/styled",
          pagePath: "pages/styled.tsx",
          frontmatter: { description: "Styled page" },
          css: ".styled { color: red; }",
        });
        assertEquals(
          document.getElementById("veryfront-spa-css")?.textContent,
          ".styled { color: red; }",
        );
        assertEquals(description.getAttribute("content"), "Styled page");

        await navigate!({
          ...initialData,
          slug: "/broken",
          pagePath: "pages/broken.tsx",
          cssError: "private CSS error",
        });
        assertEquals(document.getElementById("veryfront-spa-css"), null);
        assertEquals(warnings, ["[Veryfront SPA] Route CSS is unavailable"]);

        await navigate!({
          ...initialData,
          slug: "/styled",
          pagePath: "pages/styled.tsx",
          css: ".styled { color: red; }",
        });
        await navigate!({
          ...initialData,
          slug: "/plain",
          pagePath: "pages/plain.tsx",
          cssAction: "clear",
        });
        assertEquals(document.getElementById("veryfront-spa-css"), null);

        root.unmount();
      } finally {
        console.warn = originalWarn;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-route-css-" });
  });

  it("rejects a route CSS ownership collision instead of creating duplicate ids", async () => {
    await withTempDir(async (tempDir) => {
      for (const name of ["initial-collision", "styled-collision"]) {
        await writeModule(
          tempDir,
          `pages/${name}.js`,
          `import React from "react"; export default function Page() { return React.createElement("span", null, "${name}"); }`,
        );
      }
      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};

      try {
        await loadComponent("pages/initial-collision.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial-collision.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };
        const collision = document.createElement("div");
        collision.id = "veryfront-spa-css";
        document.head.appendChild(collision);

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();
        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!({
          ...initialData,
          slug: "/styled",
          pagePath: "pages/styled-collision.tsx",
          css: ".styled { color: red; }",
        });
        await tick();

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertEquals(document.querySelectorAll("#veryfront-spa-css").length, 1);
        assertEquals(document.getElementById("veryfront-spa-css")?.tagName, "DIV");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-route-css-collision-" });
  });

  it("contains render failures and recovers on the next navigation", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/render-initial.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "initial"); }',
      );
      await writeModule(
        tempDir,
        "pages/render-failure.js",
        'export default function Page() { throw new Error("private render detail"); }',
      );
      await writeModule(
        tempDir,
        "pages/render-recovery.js",
        'import React from "react"; export default function Page() { return React.createElement("span", null, "recovered"); }',
      );
      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};

      try {
        await loadComponent("pages/render-initial.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/render-initial.tsx",
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
        await tick();

        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!({
          ...initialData,
          slug: "/failure",
          pagePath: "pages/render-failure.tsx",
        });
        await tick();
        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertEquals((rootElement.textContent ?? "").includes("private render detail"), false);

        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!({
          ...initialData,
          slug: "/recovery",
          pagePath: "pages/render-recovery.tsx",
        });
        await tick();
        assertStringIncludes(rootElement.textContent ?? "", "recovered");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-render-boundary-" });
  });

  it("updates and restores release assets and unregisters its exact navigation handler", async () => {
    await withTempDir(async (tempDir) => {
      for (const name of ["initial", "next"]) {
        await writeModule(
          tempDir,
          `pages/${name}.js`,
          `import React from "react"; export default function Page() { return React.createElement("span", null, "${name}"); }`,
        );
      }
      const restore = installDom("https://example.com/initial");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();

      const releaseIds: Array<string | null> = [];
      const releaseMaps: Array<Record<string, string> | null> = [];
      let registeredHandler: ((data: PageDataResponse) => Promise<void>) | undefined;
      let unregisteredHandler: ((data: PageDataResponse) => Promise<void>) | undefined;
      testGlobal.__veryfrontSetReleaseId = (value) => releaseIds.push(value);
      testGlobal.__veryfrontSetReleaseAssetModules = (value) => releaseMaps.push(value);
      testGlobal.veryFrontRouter = {
        registerNavigationHandler: (handler) => {
          registeredHandler = handler;
        },
        unregisterNavigationHandler: (handler) => {
          unregisteredHandler = handler;
        },
      };

      try {
        await loadComponent("pages/initial.tsx");
        const initialData: PageDataResponse = {
          slug: "/initial",
          pagePath: "pages/initial.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
          releaseId: "release-1",
          releaseAssetModules: { "components/release-only.tsx": "/assets/initial.js" },
        };
        const root = createRoot(document.getElementById("root")!);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();

        assertEquals(releaseIds.at(-1), "release-1");
        assertEquals(releaseMaps.at(-1), initialData.releaseAssetModules);
        assertEquals(typeof registeredHandler, "function");

        const nextReleaseMap = { "components/release-only.tsx": "/assets/next.js" };
        await registeredHandler!({
          ...initialData,
          slug: "/next",
          pagePath: "pages/next.tsx",
          releaseId: "release-2",
          releaseAssetModules: nextReleaseMap,
        });
        assertEquals(releaseIds.at(-1), "release-2");
        assertEquals(releaseMaps.at(-1), nextReleaseMap);

        const collision = document.createElement("div");
        collision.id = "veryfront-spa-css";
        document.head.appendChild(collision);
        const originalError = console.error;
        console.error = () => {};
        try {
          await registeredHandler!({
            ...initialData,
            slug: "/failed-release",
            pagePath: "pages/initial.tsx",
            releaseId: "release-3",
            releaseAssetModules: {
              "components/release-only.tsx": "/assets/failed.js",
            },
            css: ".failed-release { color: red; }",
          });
        } finally {
          console.error = originalError;
          collision.remove();
        }
        assertEquals(releaseIds.at(-1), "release-2");
        assertEquals(releaseMaps.at(-1), nextReleaseMap);

        testGlobal.veryFrontRouter = {
          unregisterNavigationHandler: () => {
            throw new Error("replacement router must not receive cleanup");
          },
        };
        root.unmount();
        assertStrictEquals(unregisteredHandler, registeredHandler);
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        delete testGlobal.__veryfrontSetReleaseId;
        delete testGlobal.__veryfrontSetReleaseAssetModules;
        delete testGlobal.veryFrontRouter;
        restore();
      }
    }, { prefix: "vf-client-release-assets-" });
  });
});
