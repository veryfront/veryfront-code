import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildAppRoutes, buildPagesRoutes } from "./static-generation.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontRenderer } from "#veryfront/rendering/orchestrator/ssr.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createMockAdapter as createMemoryAdapter } from "#veryfront/platform/adapters/mock.ts";

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

describe(
  "build/production-build/static-generation",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
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
        assertStringIncludes(
          html,
          '<script type="module" src="/_veryfront/rsc/client.js"></script>',
        );
        assertEquals(html.includes("/_veryfront/app.js"), false);
        assertEquals(html.includes("/_vf_styles/styles.css"), false);
        const cssPath = [...adapter.fs.files.keys()].find((path) =>
          path.startsWith("/tmp/output/_vf/css/") && path.endsWith(".css")
        );
        assertEquals(typeof cssPath, "string");
        assertStringIncludes(adapter.fs.files.get(cssPath!) ?? "", ".h-screen");
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

      it("should handle renderer errors gracefully", async () => {
        const errorRenderer = {
          renderPage: () => Promise.reject(new Error("render failed")),
          destroy: () => Promise.resolve(),
        } as unknown as VeryfrontRenderer;

        const stats = await buildPagesRoutes(
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
        );
        // Should not throw, just skip the failed page
        assertEquals(stats.pages, 0);
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
