import { describe, it } from "@veryfront/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "@veryfront/testing/assert";
import { extractHeadElements, wrapInHTMLShell } from "./html-shell-generator.ts";
import type { RenderMetadata } from "@veryfront/types";
import type { HTMLGenerationOptions } from "./types.ts";

describe("html-generation/html-shell-generator", () => {
  const mockConfig: any = {
    dev: {
      components: [],
    },
  };

  describe("extractHeadElements", () => {
    it("should extract title from Head wrapper", () => {
      const content = `
        <div data-veryfront-head="1" style="display:none">
          <title>My Page Title</title>
        </div>
        <main>Content</main>
      `;

      const { metadata, cleanedContent } = extractHeadElements(content);

      assertEquals(metadata.title, "My Page Title");
      assertStringIncludes(
        cleanedContent,
        '<div data-veryfront-head="1" style="display:none"></div>',
      );
    });

    it("should extract description from Head wrapper", () => {
      const content = `
        <div data-veryfront-head="1" style="display:none">
          <meta name="description" content="Page description"/>
        </div>
        <main>Content</main>
      `;

      const { metadata } = extractHeadElements(content);

      assertEquals(metadata.description, "Page description");
    });

    it("should collect all meta tags", () => {
      const content = `
        <div data-veryfront-head="1" style="display:none">
          <meta property="og:title" content="OG Title"/>
          <meta name="twitter:card" content="summary_large_image"/>
        </div>
        <main>Content</main>
      `;

      const { metadata } = extractHeadElements(content);

      assertEquals(metadata.metas.length, 2);
      assertEquals(metadata.metas[0]?.property, "og:title");
      assertEquals(metadata.metas[0]?.content, "OG Title");
      assertEquals(metadata.metas[1]?.name, "twitter:card");
      assertEquals(metadata.metas[1]?.content, "summary_large_image");
    });

    it("should keep og: and twitter: meta in headElements", () => {
      const content = `
        <div data-veryfront-head="1" style="display:none">
          <title>Title</title>
          <meta property="og:image" content="/image.png"/>
        </div>
        <main>Content</main>
      `;

      const { headElements } = extractHeadElements(content);

      // og: meta should remain in headElements (injected before </head>)
      assertStringIncludes(headElements, 'property="og:image"');
      // title should NOT be in headElements (handled by shell)
      assert(!headElements.includes("<title>"));
    });

    it("should handle multiple Head wrappers", () => {
      const content = `
        <div data-veryfront-head="1" style="display:none">
          <title>First Title</title>
        </div>
        <div data-veryfront-head="1" style="display:none">
          <title>Second Title</title>
          <meta name="description" content="Second description"/>
        </div>
        <main>Content</main>
      `;

      const { metadata } = extractHeadElements(content);

      // Last title wins
      assertEquals(metadata.title, "Second Title");
      assertEquals(metadata.description, "Second description");
    });
  });

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

    it("should include Tailwind CDN in development mode", async () => {
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

      // In development, use Tailwind CDN for runtime CSS compilation (works with 'use client' pages)
      assertStringIncludes(result, "cdn.tailwindcss.com");
      assertStringIncludes(
        result,
        "<!-- Tailwind CSS: CDN in dev (runtime compilation), UnoCSS in prod (pre-generated) -->",
      );
    });

    it("should use Tailwind CDN and UnoCSS-generated CSS in production mode", async () => {
      const meta: RenderMetadata = {
        title: "Test Page",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
      };

      const result = await wrapInHTMLShell("<div>Content</div>", meta, options);

      // In production, use both Tailwind CDN (runtime) and UnoCSS pre-generated CSS
      // CDN ensures all classes work, UnoCSS provides faster initial render
      assertStringIncludes(result, "cdn.tailwindcss.com");
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

      const devResult = await wrapInHTMLShell(
        "<div>Content</div>",
        meta,
        { mode: "development", config: mockConfig },
      );

      const prodResult = await wrapInHTMLShell(
        "<div>Content</div>",
        meta,
        { mode: "production", config: mockConfig },
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

    it("should use title from Head component over frontmatter default", async () => {
      const meta: RenderMetadata = {
        title: "Veryfront App", // Default title
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
      };

      // Simulate SSR output with Head component containing a title
      const contentWithHead = `
        <div data-veryfront-head="1" style="display:none">
          <title>My Custom Page Title</title>
        </div>
        <main>Content</main>
      `;

      const result = await wrapInHTMLShell(contentWithHead, meta, options);

      // Should have exactly ONE title tag with the Head component's value
      const titleMatches = result.match(/<title>/g);
      assert(
        titleMatches?.length === 1,
        `Expected exactly 1 title tag, found ${titleMatches?.length}`,
      );
      assertStringIncludes(result, "<title>My Custom Page Title</title>");
      assert(!result.includes("<title>Veryfront App</title>"), "Should not include default title");
    });

    it("should use description from Head component over default", async () => {
      const meta: RenderMetadata = {
        title: "Test",
        slug: "test",
        frontmatter: {
          description: "Default description",
        },
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
      };

      const contentWithHead = `
        <div data-veryfront-head="1" style="display:none">
          <meta name="description" content="Custom description from Head"/>
        </div>
        <main>Content</main>
      `;

      const result = await wrapInHTMLShell(contentWithHead, meta, options);

      // Should have the Head component's description
      assertStringIncludes(result, 'content="Custom description from Head"');
      assert(
        !result.includes('content="Default description"'),
        "Should not include default description",
      );
    });

    it("should keep og: and twitter: meta tags from Head component", async () => {
      const meta: RenderMetadata = {
        title: "Test",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
      };

      const contentWithHead = `
        <div data-veryfront-head="1" style="display:none">
          <title>Page Title</title>
          <meta property="og:title" content="OG Title"/>
          <meta name="twitter:card" content="summary"/>
        </div>
        <main>Content</main>
      `;

      const result = await wrapInHTMLShell(contentWithHead, meta, options);

      // Title should be extracted and used in shell
      assertStringIncludes(result, "<title>Page Title</title>");

      // og: and twitter: meta should be injected
      assertStringIncludes(result, 'property="og:title"');
      assertStringIncludes(result, 'name="twitter:card"');
    });

    it("should leave empty wrapper after extraction", async () => {
      const meta: RenderMetadata = {
        title: "Test",
        slug: "test",
        frontmatter: {},
      };

      const options: HTMLGenerationOptions = {
        mode: "production",
        config: mockConfig,
      };

      const contentWithHead = `
        <div data-veryfront-head="1" style="display:none">
          <title>Page Title</title>
        </div>
        <main>Content</main>
      `;

      const result = await wrapInHTMLShell(contentWithHead, meta, options);

      // Wrapper should be empty (for hydration match)
      assertStringIncludes(result, '<div data-veryfront-head="1" style="display:none"></div>');

      // Title should be in <head>, not in body
      const bodyContent = result.split("<body")[1];
      assert(!bodyContent?.includes("<title>Page Title</title>"), "Title should not be in body");
    });
  });
});
