import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { injectHTMLContent } from "./html-injection.ts";
import { escapeHTML } from "./html-escape.ts";
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

    it("keeps replacement tokens literal in every dynamic placeholder", () => {
      const tokens = "$&|$`|$'";
      const escapedTokens = escapeHTML(tokens);
      const html = injectHTMLContent(
        [
          "<title>{{ title }}</title>",
          '<meta data-description="{{ description }}">',
          "{{ meta }}{{ links }}{{ scripts }}{{ styles }}",
          "<body>{{ content }}</body>",
        ].join(""),
        tokens,
        {
          title: tokens,
          description: tokens,
          meta: [{ name: "tokens", content: tokens }],
          links: [{ rel: "canonical", href: tokens }],
          scripts: [{ content: tokens }],
          styles: [{ content: tokens }],
        },
        { mode: "production", slug: "test" },
      );

      assertStringIncludes(html, `<title>${escapedTokens}</title>`);
      assertStringIncludes(html, `data-description="${escapedTokens}"`);
      assertStringIncludes(html, `name="tokens" content="${escapedTokens}"`);
      assertStringIncludes(html, `rel="canonical" href="${escapedTokens}"`);
      assertStringIncludes(html, `<script >${tokens}</script>`);
      assertStringIncludes(html, `<style >${tokens}</style>`);
      assertStringIncludes(html, `<body>${tokens}`);
    });

    it("does not execute accessor-backed public inputs", () => {
      let metadataAccessorCalls = 0;
      let optionsAccessorCalls = 0;
      const metadata = Object.defineProperty(
        { description: "safe" },
        "title",
        {
          enumerable: true,
          get() {
            metadataAccessorCalls++;
            return "unsafe";
          },
        },
      );
      const options = Object.defineProperty(
        { mode: "production" },
        "slug",
        {
          enumerable: true,
          get() {
            optionsAccessorCalls++;
            return "unsafe";
          },
        },
      );

      assertThrows(
        () =>
          injectHTMLContent("{{ title }}", "", metadata as never, {
            mode: "production",
            slug: "test",
          }),
        Error,
        "cannot be inspected",
      );
      assertThrows(
        () => injectHTMLContent("", "", minMeta, options as never),
        Error,
        "cannot be inspected",
      );
      assertEquals(metadataAccessorCalls, 0);
      assertEquals(optionsAccessorCalls, 0);
    });

    it("passes the response nonce to all metadata script and style tags", () => {
      const html = injectHTMLContent(
        "<head>{{ scripts }}{{ styles }}</head><body></body>",
        "",
        {
          scripts: [
            { src: "/external.js", nonce: "metadata-nonce" },
            { content: "globalThis.inline=true", nonce: "metadata-nonce" },
          ],
          styles: [
            { href: "/external.css", nonce: "metadata-nonce" },
            { content: "body{color:red}", nonce: "metadata-nonce" },
          ],
        },
        {
          mode: "production",
          slug: "test",
          nonce: "response-nonce",
        },
      );

      assertStringIncludes(
        html,
        '<script src="/external.js" nonce="response-nonce"></script>',
      );
      assertStringIncludes(
        html,
        '<script nonce="response-nonce">globalThis.inline=true</script>',
      );
      assertStringIncludes(
        html,
        '<link rel="stylesheet" href="/external.css" nonce="response-nonce">',
      );
      assertStringIncludes(
        html,
        '<style nonce="response-nonce">body{color:red}</style>',
      );
      assertEquals(html.includes("metadata-nonce"), false);
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

    it("should escape script-closing sequences in prebuilt import maps", () => {
      const hostileImportMap = JSON.stringify({
        imports: {
          hostile: "</script><script>globalThis.__veryfrontImportMapBreakout = true</script>",
        },
      });
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          importMapJson: hostileImportMap,
        },
      );

      assertEquals(html.includes("</script><script>"), false);
      assertEquals(html.includes("\\u003c/script"), true);
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

    it("seeds route params into client-page hydration data (issue #2741)", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "docs/guides/intro",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          params: { slug: ["guides", "intro"] },
        },
      );

      const hydrationData = extractHydrationData(html);
      // Catch-all arrays are preserved in the payload; the client runtime joins
      // them when seeding the router (issue #2742).
      assertEquals(hydrationData.params, { slug: ["guides", "intro"] });
    });

    it("escapes </script> in route params so the hydration payload cannot break out (XSS)", () => {
      const payload = "</script><script>globalThis.pwned=1</script>";
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
          params: { slug: [payload] },
        },
      );

      // The literal breakout sequence must not appear anywhere in the output;
      // jsonForInlineScript encodes `<` as \\u003c inside the JSON value.
      assertEquals(html.includes("<script>globalThis.pwned=1</script>"), false);
      // Round-trips losslessly: if the payload had broken out of the tag, the
      // extractor's non-greedy `</script>` match would truncate the JSON and
      // JSON.parse would throw here.
      assertEquals(extractHydrationData(html).params, { slug: [payload] });
    });

    it("defaults client-page hydration params to an empty object when unset", () => {
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

      assertEquals(extractHydrationData(html).params, {});
    });

    it("keeps production client-page injection on the RSC client boot script", () => {
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

      assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
      assertEquals(html.includes("/_veryfront/hydration-runtime.js"), false);
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
