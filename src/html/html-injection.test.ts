import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectHTMLContent } from "./html-injection.ts";
import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";

const baseTemplate = `<!DOCTYPE html>
<html><head>{{ meta }}</head>
<body>{{ content }}</body></html>`;

const minMeta: HTMLMetadata = { title: "Test", description: "Desc" };

function extractHydrationData(html: string): Record<string, unknown> {
  const match = html.match(
    /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  assertExists(match?.[1], "expected hydration data script in HTML");
  return JSON.parse(match[1]);
}

describe("html/html-injection", () => {
  describe("injectHTMLContent", () => {
    it("should replace content placeholder", () => {
      const html = injectHTMLContent(
        "<div>{{ content }}</div>",
        "<p>Hello</p>",
        minMeta,
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("<p>Hello</p>"), true);
      assertEquals(html.includes("{{ content }}"), false);
    });

    it("should replace title placeholder", () => {
      const html = injectHTMLContent(
        "<title>{{ title }}</title>",
        "",
        { title: "My Title", description: "" },
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("My Title"), true);
    });

    it("should replace description placeholder", () => {
      const html = injectHTMLContent(
        "<p>{{ description }}</p>",
        "",
        { title: "", description: "My Description" },
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("My Description"), true);
    });

    it("should inject dev scripts in development mode", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        { mode: "development", slug: "test" },
      );

      assertEquals(html.includes("hmr.js"), true);
    });

    it("should inject prod scripts in production mode", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        { mode: "production", slug: "my-slug" },
      );

      assertEquals(html.includes("rsc/client.js"), true);
      assertEquals(html.includes("hydrate.js"), false);
      assertEquals(html.includes("my-slug"), false);
    });

    it("should clear dev placeholders in production mode", () => {
      const html = injectHTMLContent(
        "<div>{{ devScripts }}{{ devStyles }}</div><body></body>",
        "",
        minMeta,
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("devScripts"), false);
      assertEquals(html.includes("devStyles"), false);
    });

    it("should inject hydration data for client pages", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.pagePath, "app/page.tsx");
      assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
    });

    it("adds the provided nonce to client-page hydration data", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          nonce: "nonce-123",
        },
      );

      assertEquals(
        html.includes(
          '<script id="veryfront-hydration-data" type="application/json" nonce="nonce-123">',
        ),
        true,
      );
    });

    it("should use fs hydration strategy for local development client pages", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "development",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.clientModuleStrategy, "fs");
    });

    it("should inject studio scripts when studioEmbed is true", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          studioEmbed: true,
          projectId: "p1",
          pageId: "pg1",
        },
      );

      assertEquals(html.includes("studio-bridge.js"), true);
    });

    it("propagates the nonce to injected development styles and scripts", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "development",
          slug: "test",
          nonce: "nonce-123",
        },
      );

      assertEquals(html.includes('<style nonce="nonce-123">'), true);
      assertEquals(
        html.includes(
          '<script type="module" src="/_veryfront/rsc/client.js" nonce="nonce-123"></script>',
        ),
        true,
      );
      assertEquals(
        html.includes('<script type="module" src="/_veryfront/hmr.js" nonce="nonce-123"></script>'),
        true,
      );
    });

    it("propagates the nonce to injected production scripts", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "my-slug",
          nonce: "nonce-123",
        },
      );

      assertEquals(
        html.includes(
          '<script type="module" src="/_veryfront/rsc/client.js" nonce="nonce-123"></script>',
        ),
        true,
      );
      assertEquals(html.includes("/_veryfront/hydrate.js"), false);
    });

    it("injects preview utility CSS for remote preview full HTML documents", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          environment: "preview",
          slug: "test",
        },
      );

      assertEquals(html.includes('id="vf-tailwind-css"'), true);
      assertEquals(html.includes("/_vf_styles/styles.css?t="), true);
    });

    it("injects production project stylesheet links for full HTML documents", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          environment: "production",
          slug: "test",
          projectStylesheetHref: "/_vf/css/abc123.css",
        },
      );

      assertEquals(html.includes('<link rel="stylesheet" href="/_vf/css/abc123.css">'), true);
    });
  });
});
