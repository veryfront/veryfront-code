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
import { MAX_HTML_OUTPUT_BYTES } from "./limits.ts";

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
      projectId: "test-project",
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

    it("should include content in the body", async () => {
      const result = await wrapInHTMLShell(
        "<h1>Hello World</h1>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, "<h1>Hello World</h1>");
    });

    it("preserves leading and trailing whitespace in rendered content", async () => {
      const content = "\n  <span>preserve hydration text boundaries</span>  \n";
      const result = await wrapInHTMLShell(
        content,
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, `>${content}</div>`);
    });

    it("rejects rendered content that exceeds the HTML output budget", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "x".repeat(MAX_HTML_OUTPUT_BYTES + 1),
            createMeta(),
            createOptions(),
          ),
        Error,
        "size limit",
      );
    });

    it("rejects unsupported generation modes at the runtime boundary", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({ mode: "fallback" as never }),
          ),
        Error,
        "mode",
      );
    });

    it("does not execute shell input accessors", async () => {
      let metadataAccessorCalls = 0;
      const metadata: Record<string, unknown> = { title: "Test" };
      Object.defineProperty(metadata, "slug", {
        enumerable: true,
        get() {
          metadataAccessorCalls++;
          return "private";
        },
      });
      await assertRejects(
        () => wrapInHTMLShell("<p>content</p>", metadata as never, createOptions()),
        TypeError,
        "HTML shell metadata must not contain accessor properties",
      );
      assertEquals(metadataAccessorCalls, 0);

      let optionAccessorCalls = 0;
      const options: Record<string, unknown> = {
        config: mockConfig,
        projectId: "test-project",
      };
      Object.defineProperty(options, "mode", {
        enumerable: true,
        get() {
          optionAccessorCalls++;
          return "development";
        },
      });
      await assertRejects(
        () => wrapInHTMLShell("<p>content</p>", createMeta(), options as never),
        TypeError,
        "HTML shell options must not contain accessor properties",
      );
      assertEquals(optionAccessorCalls, 0);
    });

    it("rejects unsupported deployment environments at the runtime boundary", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({ environment: "staging" as never }),
          ),
        Error,
        "environment",
      );
    });

    it("validates every supplied project identity", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({
              projectId: "invalid/project",
              projectSlug: "valid-project",
            }),
          ),
        Error,
        "project ID",
      );
    });

    it("rejects oversized project CSS candidates before cloning the set", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta(),
            createOptions({
              projectClasses: new Set(["x".repeat(1025)]),
            }),
          ),
        Error,
        "CSS candidate",
      );
    });

    it("rejects oversized slugs before embedding them in HTML and hydration data", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<p>content</p>",
            createMeta({ slug: "s".repeat(2049) }),
            createOptions(),
          ),
        Error,
        "slug",
      );
    });

    it("should set title from metadata", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({ title: "My Test Page" }),
        createOptions(),
      );

      assertStringIncludes(result, "<title>My Test Page</title>");
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

      assertStringIncludes(result, "<title>Frontmatter Title</title>");
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

    it("should use projectSlug for manifest-based module preloads", async () => {
      clearAllManifests();
      recordSSRModules("project-slug", "test-page", [
        "_veryfront/react/components/BenchInteractiveButton.js",
      ]);

      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          mode: "production",
          environment: "production",
          isLocalProject: false,
          pagePath: "pages/test-page.tsx",
          projectId: "default",
          projectSlug: "project-slug",
        }),
      );
      clearAllManifests();

      assertStringIncludes(
        result,
        '<link rel="modulepreload" href="/_vf_modules/_veryfront/react/components/BenchInteractiveButton.js">',
      );
    });

    it("omits unsafe legacy route-manifest URLs", async () => {
      clearAllManifests();
      recordSSRModules("hostile-project", "test-page", [
        'modules/evil"><script>alert(1)</script>.js',
      ]);

      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          pagePath: "pages/test-page.tsx",
          projectSlug: "hostile-project",
        }),
      );
      clearAllManifests();

      assertEquals(
        result.includes("modules/evil"),
        false,
      );
    });

    it("omits encoded traversal in legacy route-manifest URLs", async () => {
      clearAllManifests();
      recordSSRModules("encoded-traversal-project", "test-page", [
        "%2e%2e/private.js",
      ]);

      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          pagePath: "pages/test-page.tsx",
          projectSlug: "encoded-traversal-project",
        }),
      );
      clearAllManifests();

      assertEquals(result.includes("private.js"), false);
      assertEquals(result.includes("%2e%2e"), false);
    });

    it("rejects page and layout paths outside the project directory", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({
              projectDir: "/project",
              pagePath: "/private/workspace/secret-pages/dashboard.tsx",
            }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({
              projectDir: "/project",
              nestedLayouts: [
                { kind: "tsx", path: "/private/workspace/secret-layouts/root.tsx" },
              ],
            }),
          ),
        TypeError,
        "Hydration layout path is invalid",
      );
    });

    it("rejects absolute filesystem paths when projectDir is unavailable", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({ pagePath: "/private/workspace/pages/dashboard.tsx" }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
    });

    it("rejects project-directory prefix collisions in module preloads", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({
              projectDir: "/project",
              pagePath: "/project-secret/pages/admin.tsx",
            }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
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

    it("rejects in-project filenames with unsafe URL characters", async () => {
      const hostilePagePath = '/project/pages/dashboard"><script>alert(1)</script>.tsx';
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({
              projectDir: "/project",
              pagePath: hostilePagePath,
            }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
    });

    it("rejects release-manifest module URLs with invalid content hashes", async () => {
      const hostileHash = 'hash"><script>alert(1)</script>';
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "source",
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
        fallback: { mode: "jit", gaps: [] },
      };
      const options = {
        ...createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/dashboard.tsx",
        }),
        releaseAssetManifest: manifest,
      };
      await assertRejects(
        () => wrapInHTMLShell("<div>Content</div>", createMeta(), options),
        TypeError,
        "Release asset module entry is invalid",
      );
    });

    it("rejects release manifests with excessive module preload closures", async () => {
      const moduleEntries = Array.from({ length: 513 }, (_, index) => {
        const path = `components/module-${index}.tsx`;
        return [
          path,
          {
            contentHash: index.toString(16).padStart(64, "0"),
            size: 1,
            contentType: "text/javascript",
          },
        ] as const;
      });
      const manifest: ReleaseAssetManifest = {
        schemaVersion: 1,
        projectId: "project",
        releaseId: "release",
        releaseVersion: 1,
        manifestVersion: 1,
        builderVersion: "test",
        sourceContentHash: "source",
        createdAt: "2026-01-01T00:00:00.000Z",
        assetBasePath: "/_vf/assets",
        modules: Object.fromEntries(moduleEntries),
        css: [],
        routes: {
          "/dashboard": { modules: moduleEntries.map(([path]) => path), css: [] },
        },
        dependencies: {},
        fallback: { mode: "jit", gaps: [] },
      };

      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            {
              ...createOptions({
                projectDir: "/project",
                pagePath: "/project/pages/dashboard.tsx",
              }),
              releaseAssetManifest: manifest,
            },
          ),
        Error,
        "preload hints",
      );
    });

    it("preloads Markdown page modules with their compiled extension", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({
          projectDir: "/project",
          pagePath: "/project/pages/readme.md",
        }),
      );

      assertStringIncludes(result, 'href="/_vf_modules/pages/readme.js"');
      assertEquals(result.includes("readme.md.js"), false);
    });

    it("rejects relative module paths containing traversal segments", async () => {
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({ pagePath: "pages/../private/secret.tsx" }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
    });

    it("rejects relative module paths with deeply encoded traversal", async () => {
      let traversal = "%2e%2e";
      for (let layer = 0; layer < 12; layer++) {
        traversal = traversal.replaceAll("%", "%25");
      }

      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({ pagePath: `pages/${traversal}/private/secret.tsx` }),
          ),
        TypeError,
        "Hydration page path is invalid",
      );
    });

    it("should include Tailwind CSS link in development mode", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions(),
      );

      assertStringIncludes(result, 'id="vf-tailwind-css"');
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

    it("rejects production rendering when CSS generation has no valid result", async () => {
      const error = await assertRejects(() =>
        wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions({
            mode: "production",
            environment: "production",
            isLocalProject: false,
          }),
          undefined,
          undefined,
          Promise.resolve(null),
        )
      );

      assertEquals((error as { slug?: string }).slug, "render-error");
    });

    it("should reject production CSS generation without a project identity", async () => {
      const error = await assertRejects(() =>
        wrapInHTMLShell(
          "<div>Content</div>",
          createMeta(),
          createOptions({
            mode: "production",
            environment: "production",
            isLocalProject: false,
            projectId: undefined,
            projectSlug: undefined,
          }),
        )
      );

      assertEquals(
        (error as { slug?: string }).slug,
        "input-validation-failed",
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
    });

    it("keeps the Studio source path separate from the hydration module path", async () => {
      const result = await wrapInHTMLShell(
        "<div>Snippet</div>",
        createMeta({ slug: "components-button" }),
        createOptions({
          studioEmbed: true,
          studioProjectId: "studio-project",
          pageId: "page-1",
          pagePath: "_snippets/abc123",
          studioPagePath: "components/button.snippet.mdx",
        }),
      );

      assertStringIncludes(result, '"pagePath":"components/button.snippet.mdx"');
      assertStringIncludes(result, '"projectId":"studio-project"');
      assertStringIncludes(result, '"pagePath":"_snippets/abc123"');
    });

    it("does not promote an oversized page slug to a Studio project identifier", async () => {
      const result = await wrapInHTMLShell(
        "<div>Preview</div>",
        createMeta({ slug: "s".repeat(300) }),
        createOptions({
          projectId: undefined,
          studioEmbed: true,
          pagePath: "pages/preview.tsx",
        }),
      );

      assertStringIncludes(result, '"projectId":""');
      assertStringIncludes(result, '"pageId":"pages/preview.tsx"');
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

    it("rejects unsupported runtime color schemes", async () => {
      const hostile = 'dark" onload="globalThis.pwned=1';
      await assertRejects(
        () =>
          wrapInHTMLShell(
            "<div>Content</div>",
            createMeta(),
            createOptions({
              colorScheme: hostile as HTMLGenerationOptions["colorScheme"],
              colorSchemeFromParam: true,
            }),
          ),
        Error,
        "color scheme",
      );
    });

    it("does not monkeypatch console.error to hide production hydration errors", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta(),
        createOptions({ mode: "production", isLocalProject: false }),
      );

      assertEquals(result.includes("console.error = function"), false);
      assertEquals(result.includes("Minified React error #4"), false);
    });

    it("propagates CSP nonces to metadata scripts and styles", async () => {
      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        createMeta({
          frontmatter: {
            scripts: [{ src: "/app.js" }, { content: "globalThis.ready = true" }],
            styles: [{ content: "body { color: black; }" }],
          },
        }),
        createOptions({ nonce: "nonce-123" }),
      );

      assertStringIncludes(result, 'src="/app.js" nonce="nonce-123"');
      assertStringIncludes(result, '<script nonce="nonce-123"');
      assertStringIncludes(result, '<style nonce="nonce-123"');
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
