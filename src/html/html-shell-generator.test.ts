import "#veryfront/schemas/_test-setup.ts";
import "./styles-builder/__tests__/css-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import {
  clearAllManifests,
  recordSSRModules,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import { wrapInHTMLShell } from "./html-shell-generator.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";
import { getProdHydrationModulePath } from "./hydration-script-builder/prod-scripts.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { FakeTime } from "#std/testing/time";

const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";
const ENCODED_PIN_KEY_A = encodeURIComponent(PIN_KEY_A);
const ENCODED_PIN_KEY_B = encodeURIComponent(PIN_KEY_B);

describe("html-generation/html-shell-generator", () => {
  const mockConfig = {
    dev: {
      components: [],
    },
  };

  function createMeta(
    overrides: Partial<RenderMetadata> = {},
  ): RenderMetadata {
    return {
      title: "Test Page",
      slug: "test",
      frontmatter: {},
      ...overrides,
    };
  }

  function createOptions(
    overrides: Partial<HTMLGenerationOptions> = {},
  ): HTMLGenerationOptions {
    return {
      mode: "development",
      config: mockConfig,
      ...overrides,
    };
  }

  describe("wrapInHTMLShell", () => {
    it("should generate complete HTML document", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello</h1>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, "<!DOCTYPE html>");
      assertStringIncludes(result, "<html");
      assertStringIncludes(result, "<head>");
      assertStringIncludes(result, "<body");
      assertStringIncludes(result, "suppressHydrationWarning");
      assertStringIncludes(result, "</html>");
    });

    it("emits the charset before every production head script", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello</h1>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
        }),
      );
      const head = result.slice(
        result.indexOf("<head>") + "<head>".length,
        result.indexOf("</head>"),
      ).trimStart();

      assert(
        head.startsWith('<meta charset="UTF-8">'),
        "The encoding declaration must precede scripts and other head content",
      );
      assert(
        result.indexOf('<meta charset="UTF-8">') < result.indexOf("<script"),
        "No production head script may precede the encoding declaration",
      );
    });

    it("fails closed when a release shell has no selected hydration runtime", async () => {
      const error = await assertRejects(
        () =>
          wrapInHTMLShell(
            "<h1>Aged release</h1>",
            createMeta(),
            createOptions({
              mode: "production",
              releaseId: "release-aged",
              studioEmbed: true,
            }),
          ),
        Error,
      );

      assertEquals((error as { slug?: unknown }).slug, "render-error");
    });

    it("should include content in the body", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello World</h1>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, "<h1>Hello World</h1>");
    });

    it("should set title from metadata", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ title: "My Test Page" }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<title data-vf-shell-head="true">My Test Page</title>',
      );
    });

    it("should use frontmatter title if provided", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({
          title: "Default Title",
          frontmatter: { title: "Frontmatter Title" },
        }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<title data-vf-shell-head="true">Frontmatter Title</title>',
      );
    });

    it("should include import map", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, '<script type="importmap">');
      assertStringIncludes(result, '"imports"');
      assertStringIncludes(result, '"react"');
    });

    it("should use custom import map if provided", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: {
            "custom-lib": "https://cdn.example.com/lib.js",
          },
        }),
      );

      assertStringIncludes(result, '"custom-lib"');
      assertStringIncludes(result, "https://cdn.example.com/lib.js");
    });

    it("should not allow custom import maps to close the import-map script", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: {
            hostile: "</script><script>globalThis.__veryfrontImportMapBreakout = true</script>",
          },
        }),
      );

      assertEquals(result.includes("</script><script>"), false);
      assertStringIncludes(result, "\\u003c/script");
    });

    it("should preload react/jsx-runtime to eliminate waterfall delay", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      // jsx-runtime must be modulepreloaded so the browser fetches it early,
      // rather than discovering it late when modules execute (~500ms saving)
      assertStringIncludes(result, 'rel="modulepreload"');
      assertStringIncludes(result, "jsx-runtime");
      // Verify it appears BEFORE the body tag (in <head>)
      const preloadIndex = result.indexOf("jsx-runtime");
      const bodyIndex = result.indexOf("<body");
      assert(
        preloadIndex < bodyIndex,
        "jsx-runtime preload should be in <head>, before <body>",
      );
    });

    it("escapes custom jsx-runtime URLs in modulepreload attributes", async () => {
      const hostileRuntimeUrl =
        'https://cdn.example.com/jsx-runtime.js?value="><script>alert(1)</script>';
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          importMap: { "react/jsx-runtime": hostileRuntimeUrl },
        }),
      );

      assertStringIncludes(
        result,
        'href="https://cdn.example.com/jsx-runtime.js?value=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
      );
      assertEquals(result.includes(`href="${hostileRuntimeUrl}"`), false);
    });

    it("does not re-parse generated import map JSON for jsx-runtime preload", async () => {
      const originalParse = JSON.parse;
      let importMapParseCalls = 0;

      JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
        if (typeof text === "string" && text.includes('"react/jsx-runtime"')) {
          importMapParseCalls++;
          throw new Error("import map JSON should not be parsed by shell generation");
        }

        return originalParse(text, reviver);
      }) as typeof JSON.parse;

      try {
        const result = await wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions(),
        );

        assertStringIncludes(result, "jsx-runtime");
        assertEquals(importMapParseCalls, 0);
      } finally {
        JSON.parse = originalParse;
      }
    });

    it("does not emit SSR-derived legacy route manifest modules as HTML preloads", async () => {
      clearAllManifests();
      recordSSRModules("project-slug", "dashboard", [
        "lib/api.js",
        "lib/files.js",
        "lib/fs-files.js",
      ]);

      try {
        const result = await wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions({
            projectDir: "/project",
            pagePath: "/project/pages/dashboard.tsx",
            mode: "production",
            environment: "production",
            isLocalProject: false,
            projectId: "default",
            projectSlug: "project-slug",
          }),
        );

        assertStringIncludes(
          result,
          '<link rel="modulepreload" href="/_vf_modules/pages/dashboard.js">',
        );
        assertEquals(result.includes("/_vf_modules/lib/api.js"), false);
        assertEquals(result.includes("/_vf_modules/lib/files.js"), false);
        assertEquals(result.includes("/_vf_modules/lib/fs-files.js"), false);
      } finally {
        clearAllManifests();
      }
    });

    it("omits page and layout preloads outside the project directory", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/private/workspace/secret-pages/dashboard.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/private/workspace/secret-layouts/root.tsx" },
          ],
        }),
      );

      assertEquals(result.includes("/private/workspace/"), false);
      assertEquals(result.includes("secret-pages/dashboard.js"), false);
      assertEquals(result.includes("secret-layouts/root.js"), false);
    });

    it("rejects project-directory prefix collisions in module preloads", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project-secret/pages/admin.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/project-secret/app/layout.tsx" },
          ],
        }),
      );

      assertEquals(result.includes("secret/pages/admin.js"), false);
      assertEquals(result.includes("secret/app/layout.js"), false);
      assertEquals(result.includes("/project-secret/"), false);
    });

    it("preserves module preloads for paths inside the project directory", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/dashboard.tsx",
          nestedLayouts: [
            { kind: "tsx", path: "/project/app/layout.tsx" },
          ],
        }),
      );

      assertStringIncludes(
        result,
        '<link rel="modulepreload" href="/_vf_modules/pages/dashboard.js">',
      );
      assertStringIncludes(
        result,
        '<link rel="modulepreload" href="/_vf_modules/app/layout.js">',
      );
    });

    it("binds page and layout fallback preloads to historical snapshot A after B", async () => {
      const common = createOptions({
        projectDir: "/project",
        pagePath: "/project/pages/dashboard.tsx",
        nestedLayouts: [
          { kind: "tsx", path: "/project/app/layout.tsx" },
        ],
      });
      const snapshotB = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        {
          ...common,
          dependencyPinningCacheKey: PIN_KEY_B,
          dependencyPinningDependencies: {
            react: "19.0.0",
            veryfront: "0.2.0",
          },
        },
      );
      const snapshotA = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        {
          ...common,
          dependencyPinningCacheKey: PIN_KEY_A,
          dependencyPinningDependencies: {
            react: "18.3.1",
            veryfront: "0.1.10",
          },
        },
      );

      assertStringIncludes(
        snapshotB,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_B}/pages/dashboard.js">`,
      );
      assertStringIncludes(
        snapshotA,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/pages/dashboard.js">`,
      );
      assertStringIncludes(
        snapshotA,
        `<link rel="modulepreload" href="/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/app/layout.js">`,
      );
      assertEquals(snapshotA.includes(ENCODED_PIN_KEY_B), false);
    });

    it("keeps flag-off fallback preload output byte-identical", async () => {
      using _time = new FakeTime(new Date("2026-07-26T00:00:00.000Z"));
      const common = createOptions({
        projectDir: "/project",
        pagePath: "/project/pages/dashboard.tsx",
        nestedLayouts: [
          { kind: "tsx", path: "/project/app/layout.tsx" },
        ],
        dependencyPinningDependencies: {
          react: "18.3.1",
          veryfront: "0.1.10",
        },
      });

      const unkeyed = await wrapInHTMLShell("<div>Content</div>", createMeta(), common);
      const flagOff = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        { ...common, dependencyPinningCacheKey: "off" },
      );

      assertEquals(flagOff, unkeyed);
    });

    it("escapes in-project filenames in modulepreload attributes", async () => {
      const hostilePagePath = '/project/pages/dashboard"><script>alert(1)</script>.tsx';
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: hostilePagePath,
        }),
      );

      assertStringIncludes(
        result,
        'href="/_vf_modules/pages/dashboard&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;.js"',
      );
      assertEquals(
        result.includes(
          'href="/_vf_modules/pages/dashboard"><script>alert(1)</script>.js"',
        ),
        false,
      );
    });

    it("rejects invalid release-manifest asset hashes before generating preload URLs", async () => {
      const hostileHash = 'hash"><script>alert(1)</script>';
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 2,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: {
          "pages/dashboard.tsx": {
            contentHash: hostileHash,
            size: 1,
            contentType: "text/javascript",
          },
        },
        css: [],
        routes: {
          "/dashboard": { modules: ["pages/dashboard.tsx"], css: [] },
        },
        dependencies: {},
        dependencyMode: "immutable",
      };
      const options = {
        ...createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/dashboard.tsx",
        }),
        releaseAssetManifest: manifest,
      };
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        options,
      );

      assertEquals(
        result.includes("/_vf/assets/hash"),
        false,
      );
      assertStringIncludes(result, 'href="/_vf_modules/pages/dashboard.js"');
    });

    it("should include Tailwind CSS link in development mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'id="vf-project-css"');
      assertStringIncludes(
        result,
        "<!-- Tailwind CSS: Server-side JIT compiled -->",
      );
      assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
    });

    it("should use hashed CSS link in production mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          globalCSS: '@import "tailwindcss";',
        }),
      );

      assertStringIncludes(result, "/_vf/css/");
      assertStringIncludes(result, ".css");
      assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
      assertStringIncludes(
        result,
        "<!-- Tailwind CSS: Server-side JIT compiled -->",
      );
    });

    it("should prefer projectSlug over default projectId for production CSS caching", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "page-slug" }),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
          projectSlug: "project-slug",
          globalCSS: '@import "tailwindcss";',
        }),
      );

      assertStringIncludes(result, "/_vf/css/");
      assertStringIncludes(result, ".css");
      assert(
        !result.includes('href="/_vf/css/.css"'),
        "Should emit a real project-scoped CSS hash when projectSlug is available",
      );
    });

    it("should not emit /_vf/css/.css when CSS hash is empty", async () => {
      // Bug regression: when Tailwind compilation fails, cssHash is ""
      // and the old code emitted <link href="/_vf/css/.css"> which 404s.
      // Trigger empty hash by using projectId "default" (skips CSS generation).
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "default" }),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          projectId: "default",
        }),
      );

      assert(
        !result.includes('href="/_vf/css/.css"'),
        "Should not emit /_vf/css/.css with empty hash",
      );
      assertStringIncludes(
        result,
        "<!-- Tailwind CSS: Server-side JIT compiled -->",
      );
    });

    it("should include hydration data script", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ slug: "test-slug" }),
        createOptions(),
        { id: "123" },
        { title: "Test" },
      );

      assertStringIncludes(result, 'id="veryfront-hydration-data"');
      assertStringIncludes(result, 'type="application/json"');
      assertStringIncludes(result, '"slug"');
      assertStringIncludes(result, '"test-slug"');
      assertEquals(
        result.indexOf('id="veryfront-hydration-data"') < result.indexOf('id="root"'),
        true,
      );
    });

    it("should include development scripts in dev mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ isLocalProject: true }),
      );

      assertStringIncludes(result, "Client-side error logger");
      assertStringIncludes(result, "veryfront-error-overlay");
    });

    it("escapes the overlay project slug so it cannot close the inline script", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          isLocalProject: true,
          projectId: "</script><script>alert(1)</script>",
        }),
      );

      assertStringIncludes(
        result,
        'window.__VF_PROJECT_SLUG__="\\u003c/script',
        "the overlay slug must be emitted with < escaped",
      );
      assertEquals(
        result.includes("</script><script>alert(1)"),
        false,
        "the overlay slug must not close the inline script",
      );
    });

    it("should include production scripts in prod mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ mode: "production", isLocalProject: false }),
      );
      const runtimePath = getProdHydrationModulePath();

      assertStringIncludes(result, runtimePath);
      assertStringIncludes(result, `rel="modulepreload" href="${runtimePath}"`);
      assert(!result.includes("Client-side error logger"));
    });

    it("should allow local production renders to force production scripts", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: true,
          forceProductionScripts: true,
        }),
      );

      assertStringIncludes(result, getProdHydrationModulePath());
      assert(!result.includes("Client-side error logger"));
      assert(!result.includes("veryfront-error-overlay"));
    });

    it("should suppress preview hmr script when production scripts are forced", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "preview",
          isLocalProject: true,
          forceProductionScripts: true,
        }),
      );

      assert(!result.includes("preview-hmr.js"));
    });

    it("emits the preview hmr script for a preview render", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "preview",
          isLocalProject: true,
        }),
      );

      assertStringIncludes(
        result,
        '<script src="/_veryfront/preview-hmr.js"',
        "preview renders must load preview-hmr.js",
      );
    });

    it("ships the markdown preview styles and mermaid bootstrap for an md page", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ pageType: "md", pagePath: "README.md" }),
      );

      assertStringIncludes(
        result,
        "https://cdn.veryfront.com/styles/github-markdown.min.css",
        "md previews must ship the prose stylesheet",
      );
      assertStringIncludes(
        result,
        "https://cdn.veryfront.com/styles/github-syntax-highlighting.min.css",
        "md previews must ship the syntax highlighting stylesheet",
      );
      assertStringIncludes(
        result,
        "https://cdn.veryfront.com/styles/mermaid.min.css",
        "md previews must ship the mermaid stylesheet",
      );
      assertStringIncludes(
        result,
        "https://esm.sh/mermaid@11",
        "md previews must bootstrap mermaid",
      );
    });

    it("opts an md page out of the markdown preview assets when prose is false", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          pageType: "md",
          pagePath: "README.md",
          frontmatter: { prose: false },
        }),
      );

      assertEquals(
        result.includes("cdn.veryfront.com/styles/github-markdown.min.css"),
        false,
        "prose:false must opt out of the markdown preview styles",
      );
      assertEquals(
        result.includes("https://esm.sh/mermaid@11"),
        false,
        "prose:false must opt out of the mermaid bootstrap",
      );
    });

    it("should handle layout disabled", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { layout: false } }),
        createOptions(),
      );

      assertStringIncludes(result, 'data-layout="none"');
    });

    it("should handle layout enabled", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'data-layout="default"');
    });

    it("should include custom meta tags from frontmatter", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({
          frontmatter: {
            description: "Test description",
            author: "John Doe",
          },
        }),
        createOptions(),
      );

      assertStringIncludes(result, 'name="description"');
      assertStringIncludes(result, "Test description");
    });

    it("should set language attribute", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { lang: "ja" } }),
        createOptions(),
      );

      assertStringIncludes(result, 'lang="ja"');
      // data-theme/color-scheme only set when colorSchemeFromParam is true
      assert(!result.includes('data-theme="light"'));
    });

    it("should use default language when not specified", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'lang="en"');
      // data-theme only set when colorSchemeFromParam is true
      assert(!result.includes('data-theme="light"'));
    });

    it("should set data-theme when colorSchemeFromParam is true", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ colorScheme: "dark", colorSchemeFromParam: true }),
      );

      assertStringIncludes(result, 'data-theme="dark"');
      assertStringIncludes(result, "color-scheme: dark");
    });

    it("should add body class if specified", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { bodyClass: "custom-body-class" } }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<body class="custom-body-class" suppressHydrationWarning>',
      );
    });

    it("escapes body class values from frontmatter", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ frontmatter: { bodyClass: `theme" onclick="alert(1)` } }),
        createOptions(),
      );

      assertStringIncludes(
        result,
        '<body class="theme&quot; onclick=&quot;alert(1)" suppressHydrationWarning>',
      );
      assert(!result.includes('class="theme" onclick="alert(1)"'));
    });

    it("should include veryfront-portals div", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'id="veryfront-portals"');
    });

    it("should escape HTML in metadata", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ title: "Test <script>alert('xss')</script>" }),
        createOptions(),
      );

      assert(!result.includes("<script>alert('xss')</script>"));
      assertStringIncludes(result, "&lt;script&gt;");
    });
  });
});
