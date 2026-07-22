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
  veryFrontRouter?: {
    registerNavigationHandler(
      handler: (data: PageDataResponse) => Promise<void>,
    ): void | (() => void);
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
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const replacements = {
    window: w,
    document: w.document,
    navigator: w.navigator,
    self: w,
    Node: w.Node,
    Element: w.Element,
    HTMLElement: w.HTMLElement,
    history: w.history,
    location: w.location,
  };
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    delete (globalThis as Record<symbol, unknown>)[NAVIGATION_STORE_KEY];
    dom.window.close();
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function waitForText(element: Element, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((element.textContent ?? "").includes(text)) return;
    await tick();
  }
}

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

  it("surfaces an initial page import failure instead of loading forever", async () => {
    await withTempDir(async (tempDir) => {
      const restore = installDom("https://example.com/missing");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      try {
        const initialData: PageDataResponse = {
          slug: "/missing",
          pagePath: "pages/missing.tsx",
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
        await waitForText(rootElement, "Something went wrong");

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertStringIncludes(rootElement.textContent ?? "", "pages/missing.tsx");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-initial-failure-" });
  });

  it("surfaces a missing initial page path instead of loading forever", async () => {
    const restore = installDom("https://example.com/missing");
    try {
      const initialData: PageDataResponse = {
        slug: "/missing",
        pagePath: "",
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
      await waitForText(rootElement, "Page component path is missing");

      assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
      assertStringIncludes(rootElement.textContent ?? "", "Page component path is missing");
      root.unmount();
    } finally {
      restore();
    }
  });

  it("surfaces an initial layout import failure instead of loading forever", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/home.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "home"); }`,
      );

      const restore = installDom("https://example.com/home");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      try {
        await loadComponent("pages/home.tsx");
        const initialData: PageDataResponse = {
          slug: "/home",
          pagePath: "pages/home.tsx",
          pageType: "tsx",
          layouts: [{ kind: "tsx", path: "layouts/missing.tsx" }],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await waitForText(rootElement, "Failed to load layout component");

        assertStringIncludes(rootElement.textContent ?? "", "Failed to load layout component");
        assertStringIncludes(rootElement.textContent ?? "", "layouts/missing.tsx");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-layout-failure-" });
  });

  it("retries a failed layout import", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/home.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "home"); }`,
      );

      const restore = installDom("https://example.com/home");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      try {
        await loadComponent("pages/home.tsx");
        const initialData: PageDataResponse = {
          slug: "/home",
          pagePath: "pages/home.tsx",
          pageType: "tsx",
          layouts: [{ kind: "tsx", path: "layouts/retry.tsx" }],
          providers: [],
          frontmatter: {},
          props: {},
          params: {},
          layoutProps: {},
        };

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await waitForText(rootElement, "Failed to load layout component");

        await writeModule(
          tempDir,
          "layouts/retry.js",
          `import React from "react";
           export default function Layout(props) {
             return React.createElement("section", null, "layout recovered ", props.children);
           }`,
        );
        rootElement.querySelector("button")!.click();
        await waitForText(rootElement, "layout recovered");

        assertStringIncludes(rootElement.textContent ?? "", "layout recovered home");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-layout-retry-" });
  });

  it("surfaces a layout import failure during SPA navigation", async () => {
    await withTempDir(async (tempDir) => {
      for (const page of ["home", "next"]) {
        await writeModule(
          tempDir,
          `pages/${page}.js`,
          `import React from "react";
           export default function Page() { return React.createElement("span", null, "${page}"); }`,
        );
      }

      const restore = installDom("https://example.com/home");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      try {
        await loadComponent("pages/home.tsx");
        const initialData: PageDataResponse = {
          slug: "/home",
          pagePath: "pages/home.tsx",
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
          slug: "/next",
          pagePath: "pages/next.tsx",
          layouts: [{ kind: "tsx", path: "layouts/missing.tsx" }],
        });
        await waitForText(rootElement, "Failed to load layout component");

        assertStringIncludes(rootElement.textContent ?? "", "layouts/missing.tsx");
        assertEquals((rootElement.textContent ?? "").includes("next"), false);
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-navigation-layout-failure-" });
  });

  it("contains page render failures and shows a recoverable error state", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/broken.js",
        `export default function Page() { throw new Error("private render detail"); }`,
      );

      const restore = installDom("https://example.com/broken");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      const errors: string[] = [];
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await loadComponent("pages/broken.tsx");
        const initialData: PageDataResponse = {
          slug: "/broken",
          pagePath: "pages/broken.tsx",
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
        await waitForText(rootElement, "The page could not be rendered");

        assertStringIncludes(rootElement.textContent ?? "", "Something went wrong");
        assertStringIncludes(rootElement.textContent ?? "", "The page could not be rendered");
        assertEquals((rootElement.textContent ?? "").includes("private render detail"), false);
        assertEquals(errors.some((entry) => entry.includes("[Veryfront SPA] Render failed")), true);
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-render-failure-" });
  });

  it("resets the render boundary after a successful same-route navigation", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/conditional.js",
        `import React from "react";
         export default function Page(props) {
           if (props.fail) throw new Error("render failed");
           return React.createElement("span", null, "recovered");
         }`,
      );

      const restore = installDom("https://example.com/conditional");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      const originalError = console.error;
      console.error = () => {};
      try {
        await loadComponent("pages/conditional.tsx");
        const initialData: PageDataResponse = {
          slug: "/conditional",
          pagePath: "pages/conditional.tsx",
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: {},
          props: { fail: true },
          params: {},
          layoutProps: {},
        };

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await waitForText(rootElement, "The page could not be rendered");

        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!({
          ...initialData,
          props: { fail: false },
        });
        await waitForText(rootElement, "recovered");

        assertStringIncludes(rootElement.textContent ?? "", "recovered");
        root.unmount();
      } finally {
        console.error = originalError;
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-render-recovery-" });
  });

  it("resets the document title when the next page has no title", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/initial.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "initial"); }`,
      );
      await writeModule(
        tempDir,
        "pages/untitled.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "untitled"); }`,
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

        const rootElement = document.getElementById("root")!;
        const root = createRoot(rootElement);
        flushSync(() => root.render(<ClientApp initialData={initialData} />));
        await tick();
        document.title = "Initial";

        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!({
          ...initialData,
          slug: "/untitled",
          pagePath: "pages/untitled.tsx",
          frontmatter: {},
        });

        assertEquals(document.title, "Veryfront App");
        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-title-" });
  });

  it("does not replace global history methods", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/home.js",
        `import React from "react";
         export default function Page() { return React.createElement("span", null, "home"); }`,
      );

      const restore = installDom("https://example.com/home");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await loadComponent("pages/home.tsx");
        const initialData: PageDataResponse = {
          slug: "/home",
          pagePath: "pages/home.tsx",
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

        assertStrictEquals(globalThis.history.pushState, originalPushState);
        assertStrictEquals(globalThis.history.replaceState, originalReplaceState);
        root.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-history-" });
  });

  it("keeps the newest mounted navigation handler when an older app unmounts", async () => {
    await withTempDir(async (tempDir) => {
      for (const page of ["first", "second", "updated"]) {
        await writeModule(
          tempDir,
          `pages/${page}.js`,
          `import React from "react";
           export default function Page() { return React.createElement("span", null, "${page}"); }`,
        );
      }

      const restore = installDom("https://example.com/second");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await Promise.all([
          loadComponent("pages/first.tsx"),
          loadComponent("pages/second.tsx"),
        ]);
        const pageData = (page: string): PageDataResponse => ({
          slug: `/${page}`,
          pagePath: `pages/${page}.tsx`,
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: { title: page },
          props: {},
          params: {},
          layoutProps: {},
        });
        const firstHost = document.getElementById("root")!;
        const secondHost = document.createElement("div");
        document.body.append(secondHost);
        const firstRoot = createRoot(firstHost);
        const secondRoot = createRoot(secondHost);

        flushSync(() => firstRoot.render(<ClientApp initialData={pageData("first")} />));
        flushSync(() => secondRoot.render(<ClientApp initialData={pageData("second")} />));
        await tick();
        const newestHandler = testGlobal.__VERYFRONT_SPA_NAVIGATE__;

        firstRoot.unmount();
        assertStrictEquals(testGlobal.__VERYFRONT_SPA_NAVIGATE__, newestHandler);
        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!(pageData("updated"));
        await tick();
        assertStringIncludes(secondHost.textContent ?? "", "updated");

        secondRoot.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-owners-" });
  });

  it("restores a pre-existing global navigation handler after unmount", () => {
    const restore = installDom("https://example.com/");
    const previousHandler = async (_data: PageDataResponse): Promise<void> => {};
    testGlobal.__VERYFRONT_SPA_NAVIGATE__ = previousHandler;
    try {
      const rootElement = document.getElementById("root")!;
      const root = createRoot(rootElement);
      const initialData: PageDataResponse = {
        slug: "/",
        pagePath: "",
        pageType: "tsx",
        layouts: [],
        providers: [],
        frontmatter: {},
        props: {},
        params: {},
        layoutProps: {},
      };

      flushSync(() => root.render(<ClientApp initialData={initialData} />));
      root.unmount();

      assertStrictEquals(testGlobal.__VERYFRONT_SPA_NAVIGATE__, previousHandler);
    } finally {
      delete testGlobal.__VERYFRONT_SPA_NAVIGATE__;
      restore();
    }
  });

  it("restores an older handler across independently evaluated client bundles", async () => {
    await withTempDir(async (tempDir) => {
      for (const page of ["first", "second", "updated"]) {
        await writeModule(
          tempDir,
          `pages/${page}.js`,
          `import React from "react";
           export default function Page() { return React.createElement("span", null, "${page}"); }`,
        );
      }

      const restore = installDom("https://example.com/first");
      testGlobal.MODULE_SERVER_URL = `file://${tempDir}`;
      clearComponentCache();
      try {
        await Promise.all([
          loadComponent("pages/first.tsx"),
          loadComponent("pages/second.tsx"),
        ]);
        const pageData = (page: string): PageDataResponse => ({
          slug: `/${page}`,
          pagePath: `pages/${page}.tsx`,
          pageType: "tsx",
          layouts: [],
          providers: [],
          frontmatter: { title: page },
          props: {},
          params: {},
          layoutProps: {},
        });
        const [{ ClientApp: FirstClientApp }, { ClientApp: SecondClientApp }] = await Promise.all([
          import("./ClientApp.tsx?navigation-owner=first"),
          import("./ClientApp.tsx?navigation-owner=second"),
        ]);
        const firstHost = document.getElementById("root")!;
        const secondHost = document.createElement("div");
        document.body.append(secondHost);
        const firstRoot = createRoot(firstHost);
        const secondRoot = createRoot(secondHost);

        flushSync(() => firstRoot.render(<FirstClientApp initialData={pageData("first")} />));
        await tick();
        const firstHandler = testGlobal.__VERYFRONT_SPA_NAVIGATE__;
        flushSync(() => secondRoot.render(<SecondClientApp initialData={pageData("second")} />));
        await tick();

        secondRoot.unmount();
        assertStrictEquals(testGlobal.__VERYFRONT_SPA_NAVIGATE__, firstHandler);
        await testGlobal.__VERYFRONT_SPA_NAVIGATE__!(pageData("updated"));
        await tick();
        assertStringIncludes(firstHost.textContent ?? "", "updated");

        firstRoot.unmount();
      } finally {
        clearComponentCache();
        delete testGlobal.MODULE_SERVER_URL;
        restore();
      }
    }, { prefix: "vf-client-app-cross-bundle-owners-" });
  });
});
