import { describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { wrapInHTMLShell } from "./html-shell-generator.ts";
import type { RenderMetadata } from "#veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";

describe("html-generation/html-shell-generator", () => {
  const mockConfig: any = {
    dev: {
      components: [],
    },
  };

  describe("wrapInHTMLShell", () => {
    it("should generate complete HTML document", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<h1>Hello</h1>", meta, options);

      assertStringIncludes(result, "<!DOCTYPE html>");
      assertStringIncludes(result, "<html");
      assertStringIncludes(result, "<head>");
      assertStringIncludes(result, "<body");
      assertStringIncludes(result, "suppressHydrationWarning");
      assertStringIncludes(result, "</html>");
    });

    it("should include content in the body", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<h1>Hello World</h1>", meta, options);

      assertStringIncludes(result, "<h1>Hello World</h1>");
    });

    it("should set title from metadata", async () => {
      const meta: RenderMetadata = {
        title: "My Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, "<title>My Test Page</title>");
    });

    it("should use frontmatter title if provided", async () => {
      const meta: RenderMetadata = {
        title: "Default Title",
        slug: "test",
        frontmatter: {
          title: "Frontmatter Title",
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, "<title>Frontmatter Title</title>");
    });

    it("should include import map", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, '<script type="importmap">');
      assertStringIncludes(result, '"imports"');
      assertStringIncludes(result, '"react"');
    });

    it("should use custom import map if provided", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
        importMap: {
          "custom-lib": "https://cdn.example.com/lib.js",
        },
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, '"custom-lib"');
      assertStringIncludes(result, "https://cdn.example.com/lib.js");
    });

    it("should include theme CSS variables", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, ":root");
      assertStringIncludes(result, "--background:");
      assertStringIncludes(result, "--foreground:");
      assertStringIncludes(result, '[data-theme="dark"]');
    });

    it("should include inline Tailwind CSS in development mode", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      // Dev mode uses inline style for HMR hot-swapping
      assertStringIncludes(result, 'id="vf-tailwind-css"');
      assertStringIncludes(
        result,
        "<!-- Tailwind CSS: Server-side JIT compiled -->",
      );
      // No CDN in new architecture
      assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
    });

    it("should use hashed CSS link in production mode", async () => {
      // CSS link requires: environment === "production" AND NODE_ENV === "production"
      const originalNodeEnv = Deno.env.get("NODE_ENV");
      Deno.env.set("NODE_ENV", "production");

      try {
        const meta: RenderMetadata = {
          title: "Test Page",
          slug: "test",
          frontmatter: {},
        };

        const options: HTMLGenerationOptions = {
          mode: "production",
          config: mockConfig,
          environment: "production", // Required for CSS link delivery
        };

        const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

        // Production mode uses hashed CSS link for immutable caching
        assertStringIncludes(result, "/_vf/css/");
        assertStringIncludes(result, ".css");
        // No CDN in new architecture
        assert(!result.includes("cdn.jsdelivr.net/npm/@tailwindcss/browser@4"));
        // Should have JIT comment
        assertStringIncludes(result, "<!-- Tailwind CSS: Server-side JIT compiled -->");
      } finally {
        // Restore original NODE_ENV
        if (originalNodeEnv !== undefined) {
          Deno.env.set("NODE_ENV", originalNodeEnv);
        } else {
          Deno.env.delete("NODE_ENV");
        }
      }
    });

    it("should include syntax highlighting styles", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, "highlight.js");
    });

    it("should use different syntax theme for dev and prod", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      // Development syntax theme (isLocalDev: true)
      const devResult = await wrapInHTMLShell(
        "<div>Content</div>",
        meta,
        { mode: "development", config: mockConfig, isLocalDev: true },
      );

      // Production syntax theme (isLocalDev: false)
      const prodResult = await wrapInHTMLShell(
        "<div>Content</div>",
        meta,
        { mode: "production", config: mockConfig, isLocalDev: false },
      );

      assertStringIncludes(devResult, "github-dark");
      assertStringIncludes(prodResult, "github.min.css");
      assert(!prodResult.includes("github-dark"));
    });

    it("should include hydration data script", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test-slug",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell(
        "<div>Content</div>",
        meta,
        options,
        { id: "123" },
        { title: "Test" },
      );

      assertStringIncludes(result, 'id="veryfront-hydration-data"');
      assertStringIncludes(result, 'type="application/json"');
      assertStringIncludes(result, '"slug"');
      assertStringIncludes(result, '"test-slug"');
    });

    it("should include development scripts in dev mode", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
        isLocalDev: true,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      // Dev mode includes client-side error logger and error overlay styling
      assertStringIncludes(result, "Client-side error logger");
      assertStringIncludes(result, "veryfront-error-overlay");
    });

    it("should include production scripts in prod mode", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
        isLocalDev: false,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, "hydrateRoot");
      assert(!result.includes("Client-side error logger"));
    });

    it("should handle layout disabled", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {
          layout: false,
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assert(!result.includes('class="vf-tailwind"'));
      assertStringIncludes(result, 'data-layout="none"');
    });

    it("should handle layout enabled", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, 'class="vf-tailwind"');
      assertStringIncludes(result, 'data-layout="default"');
    });

    it("should include custom meta tags from frontmatter", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {
          description: "Test description",
          author: "John Doe",
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, 'name="description"');
      assertStringIncludes(result, "Test description");
    });

    it("should set language attribute", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {
          lang: "ja",
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      // Client hints default to light theme, includes data-theme and color-scheme
      assertStringIncludes(result, 'lang="ja"');
      assertStringIncludes(result, 'data-theme="light"');
      assertStringIncludes(result, "color-scheme: light");
    });

    it("should use default language when not specified", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      // Default language is 'en', client hints default to light theme
      assertStringIncludes(result, 'lang="en"');
      assertStringIncludes(result, 'data-theme="light"');
    });

    it("should add body class if specified", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {
          bodyClass: "custom-body-class",
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, '<body class="custom-body-class" suppressHydrationWarning>');
    });

    it("should include veryfront-portals div", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assertStringIncludes(result, 'id="veryfront-portals"');
    });

    it("should escape HTML in metadata", async () => {
      const meta: RenderMetadata = {
        title: "Test <script>alert('xss')</script>",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "development",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      assert(!result.includes("<script>alert('xss')</script>"));
      assertStringIncludes(result, "&lt;script&gt;");
    });
  });
});
