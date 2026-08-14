import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { _renderAppRouteToHTMLForTest, renderAppRouteToHTML } from "./build-app-route-renderer.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { CLIENT_PAGE_ISLAND_ID } from "#veryfront/rendering/rsc/page-island.ts";
import { HEAD_SHELL_PROVENANCE_ATTRIBUTE } from "#veryfront/html/managed-head-protocol.ts";
import { getProjectReact } from "#veryfront/react";
import { getReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";

// React's server scheduler owns one process-lifetime MessagePort. Initialize it
// during module setup so per-test sanitizers only track resources each render owns.
await Promise.all([getProjectReact(), getReactDOMServer()]);

async function makeProject(
  appDirectory = "app",
): Promise<{ projectDir: string; pageFile: string }> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-renderer-" });

  const appDir = join(projectDir, appDirectory);
  await Deno.mkdir(appDir, { recursive: true });
  await Deno.writeTextFile(
    join(appDir, "layout.tsx"),
    `export default function Layout({ children }: { children: React.ReactNode }) {
  return <main data-testid="app-layout">{children}</main>;
}
`,
  );
  const pageFile = join(appDir, "page.tsx");
  await Deno.writeTextFile(
    pageFile,
    `"use client";

export default function Page() {
  return <button type="button">Open uploads</button>;
}
`,
  );

  return { projectDir, pageFile };
}

async function makeDocumentLayoutProject(): Promise<{ projectDir: string; pageFile: string }> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-document-layout-" });

  const appDir = join(projectDir, "app");
  await Deno.mkdir(appDir, { recursive: true });
  await Deno.writeTextFile(
    join(appDir, "layout.tsx"),
    `export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><main data-testid="document-layout">{children}</main></body></html>;
}
`,
  );
  const pageFile = join(appDir, "page.tsx");
  await Deno.writeTextFile(
    pageFile,
    `"use client";

export default function Page() {
  return <button id="counter" type="button">Count: 0</button>;
}
`,
  );

  return { projectDir, pageFile };
}

async function makeNestedPageIslandProject(): Promise<{
  projectDir: string;
  pageFile: string;
}> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-page-island-" });
  const appDir = join(projectDir, "app");
  const sectionDir = join(appDir, "section");
  const reportsDir = join(sectionDir, "reports");
  const detailDir = join(reportsDir, "detail");
  await Deno.mkdir(detailDir, { recursive: true });

  await Deno.writeTextFile(
    join(appDir, "layout.tsx"),
    `export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><header data-testid="server-header">Header</header><main data-testid="server-document">{children}</main><footer data-testid="server-footer">Footer</footer></body></html>;
}
`,
  );
  await Deno.writeTextFile(
    join(sectionDir, "layout.tsx"),
    `export default function Layout({ children }: { children: React.ReactNode }) {
  return <section data-testid="server-section">{children}</section>;
}
`,
  );
  await Deno.writeTextFile(
    join(reportsDir, "layout.tsx"),
    `"use client";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div data-testid="client-reports-layout">{children}</div>;
}
`,
  );
  await Deno.writeTextFile(
    join(detailDir, "layout.tsx"),
    `"use client";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div data-testid="client-detail-layout">{children}</div>;
}
`,
  );
  const pageFile = join(detailDir, "page.tsx");
  await Deno.writeTextFile(
    pageFile,
    `"use client";

export default function Page() {
  return <button id="counter" type="button">Count: 0</button>;
}
`,
  );

  return { projectDir, pageFile };
}

async function cleanupProject(projectDir: string): Promise<void> {
  try {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  } finally {
    await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
  }
}

function extractHydrationData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  assertExists(match?.[1], "expected hydration data script");
  return JSON.parse(match[1]);
}

function extractImportMapImports(html: string): Record<string, string> {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assertExists(match?.[1], "expected import map script");
  return JSON.parse(match[1]).imports ?? {};
}

Deno.test({
  name:
    "server/build-app-route-renderer renders App Router HTML with Veryfront hydration data and runtime",
  async fn() {
    const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
    const { projectDir, pageFile } = await makeProject("src/app");

    try {
      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
        config: { directories: { app: "src/app" } },
      });

      assertStringIncludes(html, 'id="root"');
      assertStringIncludes(html, "Open uploads");
      assertStringIncludes(html, 'data-testid="app-layout"');
      assertStringIncludes(html, 'id="veryfront-hydration-data"');
      assertStringIncludes(html, getProdHydrationModulePath());
      assertEquals(html.includes("/_veryfront/app.js"), false);

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.pagePath, "src/app/page.tsx");
      assertEquals(hydrationData.slug, "");
      assertEquals(hydrationData.appRouterRoot, "src/app");
      assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
      assertEquals(hydrationData.isolatedClientPage, true);
      assertEquals(hydrationData.layouts, []);

      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
      const reactHash = "1".repeat(64);
      const reactDomHash = "2".repeat(64);
      const reactDomClientHash = "3".repeat(64);
      const jsxRuntimeHash = "4".repeat(64);
      const jsxDevRuntimeHash = "5".repeat(64);
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "local-project",
        releaseId: "standalone-dev",
        releaseVersion: 0,
        manifestVersion: 1,
        builderVersion: "0.1.810",
        sourceContentHash: "a".repeat(64),
        createdAt: "2026-06-15T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {},
        css: [],
        routes: {},
        dependencies: {
          react: {
            contentHash: reactHash,
            size: 10,
            contentType: "text/javascript",
          },
          "react-dom": {
            contentHash: reactDomHash,
            size: 10,
            contentType: "text/javascript",
          },
          "react-dom/client": {
            contentHash: reactDomClientHash,
            size: 10,
            contentType: "text/javascript",
          },
          "react/jsx-runtime": {
            contentHash: jsxRuntimeHash,
            size: 10,
            contentType: "text/javascript",
          },
          "react/jsx-dev-runtime": {
            contentHash: jsxDevRuntimeHash,
            size: 10,
            contentType: "text/javascript",
          },
        },
        dependencyMode: "immutable",
      };
      const releaseHtml = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
        config: { directories: { app: "src/app" } },
        releaseAssetManifest: manifest,
      });

      assertStringIncludes(releaseHtml, `"/_vf/assets/${reactHash}.js"`);
      assertEquals(extractImportMapImports(releaseHtml).react, `/_vf/assets/${reactHash}.js`);
    } finally {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer keeps one immutable dependency snapshot across an A-to-B package interleave",
  async fn() {
    const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    const { projectDir, pageFile } = await makeProject();
    const packageJsonPath = join(projectDir, "package.json");
    const stateA = {
      react: "19.2.4",
      veryfront: "0.1.810",
      "example-package": "1.0.0",
    };
    const stateB = {
      react: "18.3.1",
      veryfront: "0.1.900",
      "example-package": "2.0.0",
    };
    const observedLoads: Array<{
      cacheKey?: string;
      dependencies?: Readonly<Record<string, string>>;
      moduleServerOrigin?: string;
    }> = [];
    let changedToStateB = false;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: stateA }),
      );
      const oldTime = new Date(Date.now() - 10_000);
      await Deno.utime(packageJsonPath, oldTime, oldTime);

      const html = await _renderAppRouteToHTMLForTest(
        {
          adapter: denoAdapter,
          projectDir,
          routePath: "/",
          pageFile,
          contentSourceId: "test-content-source",
          moduleServerOrigin: "https://build.example",
        },
        {
          componentLoader: async (_source, filePath, _projectDir, _adapter, options) => {
            observedLoads.push({
              cacheKey: options?.dependencyPinningCacheKey,
              dependencies: options?.dependencyPinningDependencies,
              moduleServerOrigin: options?.moduleServerOrigin,
            });

            if (filePath === pageFile && !changedToStateB) {
              changedToStateB = true;
              await Deno.writeTextFile(
                packageJsonPath,
                JSON.stringify({ dependencies: stateB }),
              );
            }

            return function TestComponent() {
              return null;
            };
          },
        },
      );

      assertEquals(changedToStateB, true);
      assertEquals(observedLoads.length, 2);
      const pageLoad = observedLoads[0]!;
      const layoutLoad = observedLoads[1]!;
      assertStringIncludes(pageLoad.cacheKey ?? "", "on:");
      assertEquals(layoutLoad.cacheKey, pageLoad.cacheKey);
      assertEquals(pageLoad.dependencies, stateA);
      assertEquals(layoutLoad.dependencies, stateA);
      assertEquals(layoutLoad.dependencies === pageLoad.dependencies, true);
      assertEquals(Object.isFrozen(pageLoad.dependencies), true);
      assertEquals(pageLoad.moduleServerOrigin, "https://build.example");
      assertEquals(layoutLoad.moduleServerOrigin, "https://build.example");

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.dependencyPinningCacheKey, pageLoad.cacheKey);

      const imports = extractImportMapImports(html);
      assertStringIncludes(imports.react ?? "", "react@19.2.4");
      assertEquals((imports.react ?? "").includes("react@18.3.1"), false);

      const currentSnapshot = await getDependencyPinningSnapshot(projectDir);
      assertEquals(currentSnapshot.dependencies, stateB);
      assertEquals(currentSnapshot.cacheKey === pageLoad.cacheKey, false);
    } finally {
      clearReactVersionCache();
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name: "server/build-app-route-renderer fails when an existing layout is invalid",
  async fn() {
    const { projectDir, pageFile } = await makeProject();

    try {
      await Deno.writeTextFile(
        join(projectDir, "app", "layout.tsx"),
        "export default 42;\n",
      );

      await assertRejects(
        () =>
          renderAppRouteToHTML({
            adapter: denoAdapter,
            projectDir,
            routePath: "/",
            pageFile,
            contentSourceId: "test-content-source",
          }),
        Error,
        "Invalid layout component",
      );
    } finally {
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer isolates a client page from server layouts and hydrates only the client layout suffix",
  async fn() {
    const { projectDir, pageFile } = await makeNestedPageIslandProject();

    try {
      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/section/reports/detail",
        pageFile,
        contentSourceId: "test-content-source",
      });

      const headerIndex = html.indexOf('data-testid="server-header"');
      const documentIndex = html.indexOf('data-testid="server-document"');
      const sectionIndex = html.indexOf('data-testid="server-section"');
      const islandIndex = html.indexOf(`id="${CLIENT_PAGE_ISLAND_ID}"`);
      const reportsLayoutIndex = html.indexOf('data-testid="client-reports-layout"');
      const detailLayoutIndex = html.indexOf('data-testid="client-detail-layout"');
      const pageIndex = html.indexOf('id="counter"');
      const footerIndex = html.indexOf('data-testid="server-footer"');

      assertEquals(
        [
          headerIndex,
          documentIndex,
          sectionIndex,
          islandIndex,
          reportsLayoutIndex,
          detailLayoutIndex,
          pageIndex,
          footerIndex,
        ].every((index) => index >= 0),
        true,
      );
      assertEquals(headerIndex < documentIndex, true);
      assertEquals(documentIndex < sectionIndex, true);
      assertEquals(sectionIndex < islandIndex, true);
      assertEquals(islandIndex < reportsLayoutIndex, true);
      assertEquals(reportsLayoutIndex < detailLayoutIndex, true);
      assertEquals(detailLayoutIndex < pageIndex, true);
      assertEquals(pageIndex < footerIndex, true);

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.isolatedClientPage, true);
      assertEquals(hydrationData.layouts, [
        { kind: "tsx", path: "app/section/reports/layout.tsx" },
        { kind: "tsx", path: "app/section/reports/detail/layout.tsx" },
      ]);
      assertEquals(
        JSON.stringify(hydrationData.layouts).includes("app/layout.tsx"),
        false,
      );
      assertEquals(
        JSON.stringify(hydrationData.layouts).includes("app/section/layout.tsx"),
        false,
      );
    } finally {
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer unwraps App Router document layouts before writing the root",
  async fn() {
    const { projectDir, pageFile } = await makeDocumentLayoutProject();

    try {
      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
      });

      assertStringIncludes(html, 'id="root"');
      assertStringIncludes(html, 'data-testid="document-layout"');
      assertStringIncludes(html, 'id="counter"');
      assertEquals(html.includes('<div id="root"><html>'), false);
      assertEquals(html.includes("<body><html>"), false);
    } finally {
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer discovers route-group and dynamic layouts from the page filesystem path",
  async fn() {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-filesystem-layouts-" });
    const appDir = join(projectDir, "app");
    const groupDir = join(appDir, "(marketing)");
    const dynamicDir = join(groupDir, "[slug]");
    const pageFile = join(dynamicDir, "page.tsx");

    try {
      await Deno.mkdir(dynamicDir, { recursive: true });
      await Deno.writeTextFile(
        join(appDir, "layout.tsx"),
        `export default function Layout({ children }: { children: React.ReactNode }) {
  return <main data-testid="root-layout">{children}</main>;
}
`,
      );
      await Deno.writeTextFile(
        join(groupDir, "layout.tsx"),
        `export default function Layout({ children }: { children: React.ReactNode }) {
  return <section data-testid="route-group-layout">{children}</section>;
}
`,
      );
      await Deno.writeTextFile(
        join(dynamicDir, "layout.tsx"),
        `"use client";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <article data-testid="dynamic-layout">{children}</article>;
}
`,
      );
      await Deno.writeTextFile(
        pageFile,
        `"use client";
export default function Page() {
  return <button id="dynamic-page">Open</button>;
}
`,
      );

      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/launch",
        pageFile,
        contentSourceId: "test-content-source",
      });

      assertStringIncludes(html, 'data-testid="root-layout"');
      assertStringIncludes(html, 'data-testid="route-group-layout"');
      assertStringIncludes(html, 'data-testid="dynamic-layout"');
      assertStringIncludes(html, 'id="dynamic-page"');
      assertEquals(extractHydrationData(html).layouts, [
        { kind: "tsx", path: "app/(marketing)/[slug]/layout.tsx" },
      ]);
    } finally {
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer hoists the layout's declared <Head> title into the prerendered document",
  async fn() {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-head-" });
    const appDir = join(projectDir, "app");
    const pageFile = join(appDir, "page.tsx");

    try {
      await Deno.mkdir(appDir, { recursive: true });
      await Deno.writeTextFile(
        join(appDir, "layout.tsx"),
        `import { Head } from "veryfront/head";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head>
        <title>Assistant</title>
        <meta name="viewport" content="width=device-width, initial-scale=2.0" />
        <script type="module" src="/analytics.js"></script>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>
      {children}
    </>
  );
}
`,
      );
      await Deno.writeTextFile(
        pageFile,
        `"use client";
export default function Page() {
  return <button id="head-page" type="button">Open</button>;
}
`,
      );

      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
      });

      // The title carries shell provenance so the client head manager adopts it
      // instead of appending a second managed title.
      assertStringIncludes(
        html,
        `<title ${HEAD_SHELL_PROVENANCE_ATTRIBUTE}="true">Assistant</title>`,
      );
      assertEquals(html.includes("Veryfront App"), false);
      assertStringIncludes(html, 'href="/favicon.svg"');
      // A layout-declared viewport replaces the shell default instead of
      // shipping two competing viewport directives.
      assertEquals(html.match(/name="viewport"/g)?.length, 1);
      assertStringIncludes(html, 'content="width=device-width, initial-scale=2.0"');
      // Collected head elements close the head, after the project stylesheet,
      // matching the request-time shell's cascade order.
      const stylesheetIndex = html.indexOf('rel="stylesheet"');
      const faviconIndex = html.indexOf('href="/favicon.svg"');
      const headCloseIndex = html.indexOf("</head>");
      assertEquals(stylesheetIndex >= 0 && stylesheetIndex < faviconIndex, true);
      assertEquals(faviconIndex < headCloseIndex, true);
      // A collected module script resolves bare specifiers only if the framework
      // import map is already closed above it, and it still precedes the CSS.
      const importMapEndIndex = html.indexOf("</script>", html.indexOf('type="importmap"'));
      const collectedScriptIndex = html.indexOf('src="/analytics.js"');
      assertEquals(importMapEndIndex >= 0 && importMapEndIndex < collectedScriptIndex, true);
      assertEquals(collectedScriptIndex < stylesheetIndex, true);
    } finally {
      await cleanupProject(projectDir);
    }
  },
});

Deno.test({
  name: "server/build-app-route-renderer discovers and unwraps JavaScript document layouts",
  async fn() {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-js-layout-" });
    const appDir = join(projectDir, "app");
    const pageFile = join(appDir, "page.tsx");

    try {
      await Deno.mkdir(appDir, { recursive: true });
      await Deno.writeTextFile(
        join(appDir, "layout.jsx"),
        `export default function Layout({ children }) {
  return <html><body><main data-testid="javascript-layout">{children}</main></body></html>;
}
`,
      );
      await Deno.writeTextFile(
        pageFile,
        `"use client";
export default function Page() {
  return <button id="javascript-layout-page">Open</button>;
}
`,
      );

      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
      });

      assertStringIncludes(html, 'data-testid="javascript-layout"');
      assertStringIncludes(html, 'id="javascript-layout-page"');
      assertEquals(html.includes('<div id="root"><html>'), false);
      assertEquals(html.includes("<body><html>"), false);
    } finally {
      await cleanupProject(projectDir);
    }
  },
});
