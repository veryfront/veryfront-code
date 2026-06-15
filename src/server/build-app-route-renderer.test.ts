import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { renderAppRouteToHTML } from "./build-app-route-renderer.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";

async function makeProject(): Promise<{ projectDir: string; pageFile: string }> {
  const projectDir = await Deno.makeTempDir({ prefix: "vf-app-route-renderer-" });

  const appDir = join(projectDir, "app");
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
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);
    const { projectDir, pageFile } = await makeProject();

    try {
      const html = await renderAppRouteToHTML({
        adapter: denoAdapter,
        projectDir,
        routePath: "/",
        pageFile,
        contentSourceId: "test-content-source",
      });

      assertStringIncludes(html, 'id="root"');
      assertStringIncludes(html, "Open uploads");
      assertStringIncludes(html, 'data-testid="app-layout"');
      assertStringIncludes(html, 'id="veryfront-hydration-data"');
      assertStringIncludes(html, "/_veryfront/hydration-runtime.js");
      assertEquals(html.includes("/_veryfront/app.js"), false);

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.pagePath, "app/page.tsx");
      assertEquals(hydrationData.slug, "");
      assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
      assertEquals(hydrationData.layouts, [{ kind: "tsx", path: "app/layout.tsx" }]);

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
        releaseAssetManifest: manifest,
      });

      assertStringIncludes(releaseHtml, `"/_vf/assets/${reactHash}.js"`);
      assertEquals(extractImportMapImports(releaseHtml).react, `/_vf/assets/${reactHash}.js`);
    } finally {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name:
    "server/build-app-route-renderer unwraps App Router document layouts before writing the root",
  sanitizeOps: false,
  sanitizeResources: false,
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
      await Deno.remove(projectDir, { recursive: true }).catch(() => undefined);
    }
  },
});
