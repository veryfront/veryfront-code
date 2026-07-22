import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { buildAppRoutes, buildPagesRoutes } from "./static-generation.ts";
import { clearCSSCache, getCSSByHash } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontRenderer } from "#veryfront/rendering/orchestrator/ssr.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createMockAdapter as createMemoryAdapter } from "#veryfront/platform/adapters/mock.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { VeryfrontError } from "#veryfront/errors";
import * as React from "react";
import {
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

function createMockAdapter(): RuntimeAdapter {
  const files = new Map<string, string>();
  return {
    name: "test",
    fs: {
      readFile: (path: string) => Promise.resolve(files.get(path) ?? ""),
      writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      },
      exists: () => Promise.resolve(true),
      mkdir: () => Promise.resolve(),
      readDir: () =>
        (async function* () {
        })(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: true, size: 0 }),
      remove: () => Promise.resolve(),
      readTextFile: (path: string) => Promise.resolve(files.get(path) ?? ""),
      writeTextFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      },
    },
  } as unknown as RuntimeAdapter;
}

function createMockRenderer(): VeryfrontRenderer {
  return {
    renderPage: (_slug: string) =>
      Promise.resolve({
        html: "<html><head></head><body><div>content</div></body></html>",
        frontmatter: { title: "Test" },
        headings: [{ level: 1, text: "Test", id: "test" }],
      }),
    destroy: () => Promise.resolve(),
  } as unknown as VeryfrontRenderer;
}

function createMockConfig(): VeryfrontConfig {
  return {} as VeryfrontConfig;
}

function extractImportMapImports(html: string): Record<string, string> {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assertExists(match?.[1], "expected import map script");
  return JSON.parse(match[1]).imports ?? {};
}

function hasEsmShReactImportMapValue(imports: Record<string, string>): boolean {
  for (const value of Object.values(imports)) {
    try {
      const url = new URL(value);
      if (url.hostname === "esm.sh" && url.pathname.startsWith("/react")) return true;
    } catch {
      // Not an absolute URL import-map value.
    }
  }
  return false;
}

describe(
  "build/production-build/static-generation",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    const originalFlag = getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG);

    afterEach(() => {
      setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, originalFlag ?? "");
      resetReactCache();
      __setServerModuleLoaderForTests(null);
    });

    describe("buildAppRoutes", () => {
      it("should return empty stats for empty routes", async () => {
        const stats = await buildAppRoutes([], {
          adapter: createMockAdapter(),
          projectDir: "/tmp/project",
          outputDir: "/tmp/output",
          renderer: createMockRenderer(),
          config: createMockConfig(),
          enablePrefetch: false,
          chunkManifest: null,
        });
        assertEquals(stats.pages, 0);
        assertEquals(stats.totalSize, 0);
        assertEquals(stats.ssgPaths, []);
      });

      it("uses config.react.version for App Router SSR and the browser import map", async () => {
        const adapter = createMemoryAdapter();
        const appDir = "/tmp/project/src/site";
        adapter.fs.files.set(
          `${appDir}/page.tsx`,
          "export default function Page() { return null; }",
        );
        adapter.fs.files.set(
          `${appDir}/layout.tsx`,
          "export default function Layout() { return null; }",
        );
        const server = (marker: string) => ({
          renderToString: (node: React.ReactNode) => {
            const element = React.isValidElement<{ children?: React.ReactNode }>(node)
              ? node
              : null;
            const layoutMarker = element?.props.children ? "with-layout" : "without-layout";
            return `<p>${marker}-${layoutMarker}</p>`;
          },
          renderToStaticMarkup: () => `<p>${marker}</p>`,
        });
        __setServerModuleLoaderForTests((_url, label) => {
          if (label === "React") return Promise.resolve({ default: React });
          throw new Error(`Unexpected module load: ${label}`);
        });
        __injectReactDOMServerForTests(server("default-react"));
        __injectReactDOMServerForTests(server("project-react-18"), "18.3.1");

        await buildAppRoutes(
          [{
            path: "/",
            pageFile: `${appDir}/page.tsx`,
            segments: [],
            segmentDirs: [appDir],
          }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: {
              react: { version: "18.3.1" },
              directories: { app: "src/site" },
            } as VeryfrontConfig,
            enablePrefetch: false,
            chunkManifest: null,
          },
        );

        const html = adapter.fs.files.get("/tmp/output/index.html") ?? "";
        assertStringIncludes(html, "project-react-18-with-layout");
        const importMapReact = extractImportMapImports(html).react;
        assertExists(importMapReact);
        assertStringIncludes(importMapReact, "react@18.3.1");
      });

      it("fails the build when an app route cannot be rendered", async () => {
        const error = await assertRejects(() =>
          buildAppRoutes(
            [{
              path: "/broken",
              pageFile: "/tmp/project/app/broken/page.tsx",
              segments: ["broken"],
              segmentDirs: ["/tmp/project/app/broken"],
            }],
            {
              adapter: createMockAdapter(),
              projectDir: "/tmp/project",
              outputDir: "/tmp/output",
              renderer: createMockRenderer(),
              config: createMockConfig(),
              enablePrefetch: false,
              chunkManifest: null,
              traceStep: (name, fn) =>
                name === "app:/broken" ? Promise.reject(new Error("render failed")) : fn(),
            },
          )
        );

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, "ssg-generation-error");
        assertEquals((error as Error).message, "Failed to build app route /broken");
      });

      it("writes and links generated CSS for app router pages", async () => {
        const adapter = createMemoryAdapter();
        adapter.fs.files.set("/tmp/project/globals.css", '@import "tailwindcss";');
        adapter.fs.files.set(
          "/tmp/project/app/layout.tsx",
          `export default function Layout({ children }: { children: React.ReactNode }) {
          return <div className="flex flex-col h-screen bg-white">{children}</div>;
        }`,
        );
        adapter.fs.files.set(
          "/tmp/project/app/page.tsx",
          `export default function Page() {
          return <main className="mx-auto max-w-3xl px-4 py-3 text-sm">Hello</main>;
        }`,
        );

        const stats = await buildAppRoutes(
          [{
            path: "/",
            pageFile: "/tmp/project/app/page.tsx",
            segments: [],
            segmentDirs: ["/tmp/project/app"],
          }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
          },
        );

        assertEquals(stats.pages, 1);
        const html = adapter.fs.files.get("/tmp/output/index.html") ?? "";
        assertStringIncludes(html, '<link rel="stylesheet" href="/_vf/css/');
        assertEquals(html.includes("/_veryfront/rsc/client.js"), false);
        assertEquals(html.includes("/_veryfront/hydration-runtime.js"), false);
        assertEquals(html.includes("/_veryfront/app.js"), false);
        assertEquals(html.includes("/_vf_styles/styles.css"), false);
        const cssPath = [...adapter.fs.files.keys()].find((path) =>
          path.startsWith("/tmp/output/_vf/css/") && path.endsWith(".css")
        );
        assertEquals(typeof cssPath, "string");
        assertStringIncludes(adapter.fs.files.get(cssPath!) ?? "", ".h-screen");
      });

      it("caches generated App Router CSS by hash for runtime CSS handler lookups", async () => {
        clearCSSCache();
        const adapter = createMemoryAdapter();
        adapter.fs.files.set("/tmp/project/globals.css", '@import "tailwindcss";');
        adapter.fs.files.set(
          "/tmp/project/app/page.tsx",
          `export default function Page() {
          return <main className="mx-auto px-4">Hello</main>;
        }`,
        );

        try {
          await buildAppRoutes(
            [{
              path: "/",
              pageFile: "/tmp/project/app/page.tsx",
              segments: [],
              segmentDirs: ["/tmp/project/app"],
            }],
            {
              adapter,
              projectDir: "/tmp/project",
              outputDir: "/tmp/output",
              renderer: createMockRenderer(),
              config: createMockConfig(),
              enablePrefetch: false,
              chunkManifest: null,
            },
          );

          const html = adapter.fs.files.get("/tmp/output/index.html") ?? "";
          const hash = html.match(/\/_vf\/css\/([a-z0-9-]+)\.css/)?.[1];
          assertEquals(typeof hash, "string");
          const cached = getCSSByHash(hash!);
          assertEquals(typeof cached, "string");
          assertStringIncludes(cached!, ".mx-auto");
        } finally {
          clearCSSCache();
        }
      });

      it("includes framework component candidates in generated App Router CSS", async () => {
        const adapter = createMemoryAdapter();
        adapter.fs.files.set("/tmp/project/globals.css", '@import "tailwindcss";');
        adapter.fs.files.set(
          "/tmp/project/app/page.tsx",
          `export default function Page() {
          return <main className="px-4">Hello</main>;
        }`,
        );

        await buildAppRoutes(
          [{
            path: "/",
            pageFile: "/tmp/project/app/page.tsx",
            segments: [],
            segmentDirs: ["/tmp/project/app"],
          }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
          },
        );

        const cssPath = [...adapter.fs.files.keys()].find((path) =>
          path.startsWith("/tmp/output/_vf/css/") && path.endsWith(".css")
        );
        assertEquals(typeof cssPath, "string");
        assertStringIncludes(adapter.fs.files.get(cssPath!) ?? "", ".animate-spin");
      });
    });

    describe("buildPagesRoutes", () => {
      it("should return empty stats for empty routes", async () => {
        const stats = await buildPagesRoutes([], {
          adapter: createMockAdapter(),
          projectDir: "/tmp/project",
          outputDir: "/tmp/output",
          renderer: createMockRenderer(),
          config: createMockConfig(),
          enablePrefetch: false,
          chunkManifest: null,
        });
        assertEquals(stats.pages, 0);
        assertEquals(stats.totalSize, 0);
        assertEquals(stats.ssgPaths, []);
      });

      it("should build pages in dry run mode", async () => {
        const stats = await buildPagesRoutes(
          [{ slug: "index", path: "/", file: "pages/index.mdx" }],
          {
            adapter: createMockAdapter(),
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: true,
          },
        );
        assertEquals(stats.pages, 1);
        assertEquals(stats.totalSize > 0, true);
      });

      it("should build and write pages when not dry run", async () => {
        const adapter = createMockAdapter();
        const stats = await buildPagesRoutes(
          [{ slug: "about", path: "/about", file: "pages/about.mdx" }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: false,
          },
        );
        assertEquals(stats.pages, 1);
        assertEquals(stats.totalSize > 0, true);
      });

      it("writes transition data with root content instead of the full HTML document", async () => {
        const adapter = createMemoryAdapter();
        const renderer = {
          renderPage: () =>
            Promise.resolve({
              html:
                '<!DOCTYPE html><html><head><script>globalThis.__docScript=1</script></head><body><div id="root"><main><div>Page content</div></main></div><div id="veryfront-portals"></div><script type="module">globalThis.__boot=1</script></body></html>',
              frontmatter: { title: "About" },
              headings: [],
            }),
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        await buildPagesRoutes(
          [{ slug: "about", path: "/about", file: "pages/about.mdx" }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer,
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: false,
          },
        );

        const rawData = adapter.fs.files.get("/tmp/output/_veryfront/data/about.json") ?? "";
        const pageData = JSON.parse(rawData) as { html: string };

        assertEquals(pageData.html, "<main><div>Page content</div></main>");
        assertEquals(pageData.html.includes("<script"), false);
        assertEquals(pageData.html.includes("<!DOCTYPE html>"), false);
      });

      it("does not inject a second import map when the renderer already emitted one", async () => {
        const adapter = createMemoryAdapter();
        const renderer = {
          renderPage: () =>
            Promise.resolve({
              html:
                '<html><head><script type="importmap">{"imports":{"react":"/react.js"}}</script></head><body><div>content</div></body></html>',
              frontmatter: {},
              headings: [],
            }),
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        await buildPagesRoutes(
          [{ slug: "blog", path: "/blog", file: "pages/blog.mdx" }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer,
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: false,
          },
        );

        const html = adapter.fs.files.get("/tmp/output/blog/index.html") ?? "";
        const importMapCount = html.match(/<script type="importmap">/g)?.length ?? 0;
        assertEquals(importMapCount, 1);
        assertStringIncludes(html, "Basic styles");
      });

      it("uses the release asset manifest for rendered and injected import maps", async () => {
        setEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, "1");
        const adapter = createMemoryAdapter();
        const reactHash = "1".repeat(64);
        const reactDomHash = "2".repeat(64);
        const reactDomClientHash = "3".repeat(64);
        const jsxRuntimeHash = "4".repeat(64);
        const jsxDevRuntimeHash = "5".repeat(64);
        const headHash = "6".repeat(64);
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
            "veryfront/head": {
              contentHash: headHash,
              size: 10,
              contentType: "text/javascript",
            },
            "veryfront/react/head": {
              contentHash: headHash,
              size: 10,
              contentType: "text/javascript",
            },
          },
          fallback: { mode: "jit", gaps: [] },
        };
        const renderer = {
          renderPage: (
            _slug: string,
            options?: { releaseAssetManifest?: ReleaseAssetManifest | null },
          ) => {
            assertEquals(options?.releaseAssetManifest, manifest);
            return Promise.resolve({
              html: "<html><head></head><body><div>content</div></body></html>",
              frontmatter: {},
              headings: [],
            });
          },
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        await buildPagesRoutes(
          [{ slug: "blog", path: "/blog", file: "pages/blog.mdx" }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer,
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: false,
            releaseAssetManifest: manifest,
          },
        );

        const html = adapter.fs.files.get("/tmp/output/blog/index.html") ?? "";
        assertStringIncludes(html, `"/_vf/assets/${reactHash}.js"`);
        assertStringIncludes(html, `"/_vf/assets/${headHash}.js"`);
        assertEquals(hasEsmShReactImportMapValue(extractImportMapImports(html)), false);
        assertEquals(
          html.includes('"veryfront/head": "/_vf_modules/_veryfront/react/runtime/core.js"'),
          false,
        );
        assertEquals(
          html.includes('"veryfront/react/head": "/_vf_modules/_veryfront/react/runtime/core.js"'),
          false,
        );
      });

      it("passes a synthetic request context when rendering Pages Router routes", async () => {
        const calls: Array<{
          slug: string;
          request?: Request;
          url?: URL;
          contentSourceId?: string;
        }> = [];
        const renderer = {
          renderPage: (
            slug: string,
            options?: { request?: Request; url?: URL; contentSourceId?: string },
          ) => {
            calls.push({
              slug,
              request: options?.request,
              url: options?.url,
              contentSourceId: options?.contentSourceId,
            });
            return Promise.resolve({
              html: "<html><head></head><body><div>content</div></body></html>",
              frontmatter: {},
              headings: [],
            });
          },
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        await buildPagesRoutes(
          [
            { slug: "index", path: "/", file: "pages/index.tsx" },
            { slug: "search", path: "/search?q=jobs", file: "pages/search.tsx" },
          ],
          {
            adapter: createMockAdapter(),
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer,
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: true,
            baseUrl: "https://example.test/app",
            contentSourceId: "release-test",
          },
        );

        assertEquals(calls.length, 2);
        const rootCall = calls[0];
        const searchCall = calls[1];
        assertExists(rootCall);
        assertExists(searchCall);
        assertEquals(rootCall.slug, "index");
        assertEquals(rootCall.request?.method, "GET");
        assertEquals(rootCall.request?.url, "https://example.test/");
        assertEquals(rootCall.url?.href, "https://example.test/");
        assertEquals(rootCall.contentSourceId, "release-test");
        assertEquals(searchCall.slug, "search");
        assertEquals(searchCall.request?.url, "https://example.test/search?q=jobs");
        assertEquals(searchCall.url?.href, "https://example.test/search?q=jobs");
        assertEquals(searchCall.url?.searchParams.get("q"), "jobs");
      });

      it("records generated Pages Router paths in SSG stats", async () => {
        const stats = await buildPagesRoutes(
          [
            { slug: "index", path: "/", file: "pages/index.mdx" },
            { slug: "about", path: "/about", file: "pages/about.mdx" },
          ],
          {
            adapter: createMockAdapter(),
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: true,
          },
        );

        assertEquals(stats.pages, 2);
        assertEquals(stats.ssgPaths, ["/", "/about"]);
      });

      it("escapes route slug before embedding it in the client bootstrap script", async () => {
        const adapter = createMemoryAdapter();
        const slug = `bad";globalThis.__xss=1;//`;
        const renderer = {
          renderPage: () =>
            Promise.resolve({
              html: "<html><head></head><body><div>content</div></body></html>",
              frontmatter: { description: "</script><script>alert(1)</script>" },
              headings: [],
            }),
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        await buildPagesRoutes(
          [{ slug, path: "/bad", file: "pages/bad.mdx" }],
          {
            adapter,
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer,
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: false,
          },
        );

        const html =
          [...adapter.fs.files.values()].find((value) =>
            value.includes("Client runtime bootstrap")
          ) ?? "";
        assertStringIncludes(html, `boot({ slug: ${JSON.stringify(slug)} });`);
        assertEquals(html.includes(`boot({ slug: '${slug}' });`), false);
        assertEquals(html.includes("</script><script>alert(1)</script>"), false);
        assertStringIncludes(html, "\\u003c/script\\u003e");
      });

      it("fails the build when a page cannot be rendered", async () => {
        const errorRenderer = {
          renderPage: () => Promise.reject(new Error("render failed")),
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        const error = await assertRejects(
          () =>
            buildPagesRoutes(
              [{ slug: "bad", path: "/bad", file: "pages/bad.mdx" }],
              {
                adapter: createMockAdapter(),
                projectDir: "/tmp/project",
                outputDir: "/tmp/output",
                renderer: errorRenderer,
                config: createMockConfig(),
                enablePrefetch: false,
                chunkManifest: null,
              },
            ),
        );

        assertEquals(error instanceof VeryfrontError, true);
        assertEquals((error as VeryfrontError).slug, "ssg-generation-error");
        assertEquals((error as Error).message, "Failed to build page /bad");
      });

      it("should use custom traceStep function", async () => {
        const traced: string[] = [];
        const stats = await buildPagesRoutes(
          [{ slug: "traced", path: "/traced", file: "pages/traced.mdx" }],
          {
            adapter: createMockAdapter(),
            projectDir: "/tmp/project",
            outputDir: "/tmp/output",
            renderer: createMockRenderer(),
            config: createMockConfig(),
            enablePrefetch: false,
            chunkManifest: null,
            dryRun: true,
            traceStep: async (name, fn) => {
              traced.push(name);
              return fn();
            },
          },
        );
        assertEquals(stats.pages, 1);
        assertEquals(traced.length > 0, true);
        assertEquals(traced[0], "page:traced");
      });
    });
  },
);
