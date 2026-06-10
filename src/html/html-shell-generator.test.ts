import "#veryfront/schemas/_test-setup.ts";
import "./styles-builder/__tests__/css-processor-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  clearAllManifests,
  recordSSRModules,
} from "#veryfront/modules/manifest/route-module-manifest.ts";
import { wrapInHTMLShell } from "./html-shell-generator.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";

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

      assertStringIncludes(result, "/_veryfront/hydration-runtime.js");
      assertStringIncludes(result, 'rel="modulepreload" href="/_veryfront/hydration-runtime.js"');
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

      assertStringIncludes(result, "/_veryfront/hydration-runtime.js");
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
