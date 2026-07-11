import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { renderAppRouteToHTML } from "./build-app-route-renderer.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { CLIENT_PAGE_ISLAND_ID } from "#veryfront/rendering/rsc/page-island.ts";
import { getProjectReact } from "#veryfront/react";
import { getReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

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
        schemaVersion: 1,
        projectId: "local-project",
        releaseId: "standalone-dev",
        releaseVersion: 0,
        manifestVersion: 1,
        builderVersion: "0.1.810",
        sourceContentHash: "source",
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
        fallback: { mode: "jit", gaps: [] },
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
