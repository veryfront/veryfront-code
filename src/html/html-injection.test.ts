import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findActiveDocumentOpeningTag, injectHTMLContent } from "./html-injection.ts";
import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { MAX_HTML_OUTPUT_BYTES } from "./limits.ts";

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
  it("finds active opening tags without matching inert markup", () => {
    const html =
      '<!-- <html data-example="comment"> --><template><html></html></template><html data-example="active"><head></head><body></body></html>';
    const tag = findActiveDocumentOpeningTag(html, "html");

    assertExists(tag);
    assertEquals(html.slice(tag.start, tag.end), '<html data-example="active">');
  });

  describe("injectHTMLContent", () => {
    it("rejects unsupported runtime modes", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "staging" as never,
            slug: "test",
          }),
        Error,
        "mode",
      );
    });

    it("rejects retired Studio collaboration options in every runtime mode", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            wsUrl: "wss://studio.example.test/sync",
          }),
        Error,
        "not supported",
      );
    });

    it("does not execute injection option or metadata accessors", () => {
      let optionAccessorCalls = 0;
      const options: Record<string, unknown> = { slug: "test" };
      Object.defineProperty(options, "mode", {
        enumerable: true,
        get() {
          optionAccessorCalls++;
          return "production";
        },
      });
      assertThrows(
        () => injectHTMLContent(baseTemplate, "", minMeta, options as never),
        TypeError,
        "HTML injection options must not contain accessor properties",
      );
      assertEquals(optionAccessorCalls, 0);

      let metadataAccessorCalls = 0;
      const metadata: Record<string, unknown> = { description: "" };
      Object.defineProperty(metadata, "title", {
        enumerable: true,
        get() {
          metadataAccessorCalls++;
          return "Private title";
        },
      });
      assertThrows(
        () =>
          injectHTMLContent(
            baseTemplate,
            "",
            metadata as HTMLMetadata,
            { mode: "production", slug: "test" },
          ),
        TypeError,
        "HTML metadata must not contain accessor properties",
      );
      assertEquals(metadataAccessorCalls, 0);
    });

    it("rejects unsupported deployment environments", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            environment: "staging" as never,
          }),
        Error,
        "environment",
      );
    });

    it("rejects oversized slugs before generating scripts", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "s".repeat(2049),
          }),
        Error,
        "slug",
      );
    });

    it("rejects placeholder expansion beyond the HTML output budget", () => {
      const replacement = "x".repeat(1024 * 1024);
      const template = "{{ content }}".repeat(
        Math.ceil(MAX_HTML_OUTPUT_BYTES / replacement.length) + 1,
      );

      assertThrows(
        () =>
          injectHTMLContent(template, replacement, minMeta, {
            mode: "production",
            slug: "test",
          }),
        Error,
        "size limit",
      );
    });

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

    it("preserves dollar replacement tokens in rendered content and metadata", () => {
      const html = injectHTMLContent(
        "<html><head><title>{{ title }}</title></head><body>{{ content }}</body></html>",
        "<p>$& $` $'</p>",
        { title: "$& title", description: "" },
        { mode: "production", slug: "test" },
      );

      assertEquals(html.includes("<p>$& $` $'</p>"), true);
      assertEquals(html.includes("<title>$&amp; title</title>"), true);
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

    it("injects head assets around raw-text head-like text in stable order", () => {
      const rawScript = '<script>globalThis.example = "</head>";</script>';
      const rawStyle = '<style>main::after { content: "</head>"; }</style>';
      const template =
        `<!DOCTYPE html><html><head>${rawScript}${rawStyle}</head><body></body></html>`;
      const projectHTML = injectHTMLContent(template, "", minMeta, {
        mode: "production",
        slug: "test",
        importMapJson: '{"imports":{}}',
        projectStylesheetHref: "/_vf/css/abc123.css",
      });

      const rawStyleEnd = projectHTML.indexOf(rawStyle) + rawStyle.length;
      const importMapIndex = projectHTML.indexOf('<script type="importmap"');
      const projectStylesheetIndex = projectHTML.indexOf(
        '<link rel="stylesheet" href="/_vf/css/abc123.css">',
      );
      const projectHeadEnd = projectHTML.lastIndexOf("</head>");

      assertEquals(projectHTML.includes(rawScript), true);
      assertEquals(projectHTML.includes(rawStyle), true);
      assertEquals(importMapIndex > projectHTML.indexOf("<head>"), true);
      assertEquals(importMapIndex < projectHTML.indexOf(rawScript), true);
      assertEquals(projectStylesheetIndex >= rawStyleEnd, true);
      assertEquals(projectHeadEnd > projectStylesheetIndex, true);

      const previewHTML = injectHTMLContent(template, "", minMeta, {
        mode: "production",
        environment: "preview",
        slug: "test",
        importMapJson: '{"imports":{}}',
      });
      const previewRawStyleEnd = previewHTML.indexOf(rawStyle) + rawStyle.length;
      const previewImportMapIndex = previewHTML.indexOf('<script type="importmap"');
      const previewStylesheetIndex = previewHTML.indexOf('id="vf-tailwind-css"');

      assertEquals(previewHTML.includes(rawScript), true);
      assertEquals(previewHTML.includes(rawStyle), true);
      assertEquals(previewImportMapIndex > previewHTML.indexOf("<head>"), true);
      assertEquals(previewImportMapIndex < previewHTML.indexOf(rawScript), true);
      assertEquals(previewStylesheetIndex >= previewRawStyleEnd, true);
      assertEquals(previewHTML.lastIndexOf("</head>") > previewStylesheetIndex, true);
    });

    it("injects import maps before existing module scripts", () => {
      const moduleScript = '<script type="module">import "example";</script>';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head>${moduleScript}</head><body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          importMapJson: '{"imports":{"example":"/example.js"}}',
        },
      );

      assertEquals(html.indexOf('type="importmap"') < html.indexOf(moduleScript), true);
    });

    it("keeps ordering-sensitive head metadata before the import map", () => {
      const charset = '<meta charset="utf-8">';
      const csp = `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`;
      const base = '<base href="/assets/">';
      const moduleScript = '<script type="module">import "example";</script>';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head>${charset}${csp}${base}${moduleScript}</head><body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          importMapJson: '{"imports":{"example":"./example.js"}}',
        },
      );

      const importMapIndex = html.indexOf('type="importmap"');
      assertEquals(importMapIndex > html.indexOf(charset), true);
      assertEquals(importMapIndex > html.indexOf(csp), true);
      assertEquals(importMapIndex > html.indexOf(base), true);
      assertEquals(importMapIndex < html.indexOf(moduleScript), true);
    });

    it("keeps effective after-head metadata before the import map", () => {
      const link = '<link rel="preconnect" href="https://example.test">';
      const meta = '<meta name="referrer" content="same-origin">';
      const base = '<base href="/assets/">';
      const moduleScript = '<script type="module">import "example";</script>';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head></head>\n${link}${meta}${base}\n${moduleScript}<body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          importMapJson: '{"imports":{"example":"./example.js"}}',
        },
      );

      const importMapIndex = html.indexOf('type="importmap"');
      assertEquals(importMapIndex > html.indexOf(meta), true);
      assertEquals(importMapIndex > html.indexOf(base), true);
      assertEquals(importMapIndex < html.indexOf(moduleScript), true);
    });

    it("treats self-closing syntax on HTML raw-text elements as a parse error", () => {
      const rawScript = '<script/>globalThis.template = "</head>";</script>';
      const rawStyle = '<style/>main::after { content: "</head>"; }</style>';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head>${rawScript}${rawStyle}</head><body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          projectStylesheetHref: "/_vf/css/abc123.css",
        },
      );

      const rawStyleEnd = html.indexOf(rawStyle) + rawStyle.length;
      const stylesheetIndex = html.indexOf('href="/_vf/css/abc123.css"');
      assertEquals(html.includes(rawScript), true);
      assertEquals(html.includes(rawStyle), true);
      assertEquals(stylesheetIndex > rawStyleEnd, true);
      assertEquals(html.indexOf("</head>", stylesheetIndex) > stylesheetIndex, true);
    });

    it("injects head assets before body when the optional head end tag is omitted", () => {
      const html = injectHTMLContent(
        "<!DOCTYPE html><html><head><title>Page</title><body><main>Page</main></body></html>",
        "",
        minMeta,
        {
          mode: "production",
          environment: "production",
          slug: "test",
          importMapJson: '{"imports":{}}',
          projectStylesheetHref: "/_vf/css/abc123.css",
        },
      );

      const importMapIndex = html.indexOf('type="importmap"');
      const stylesheetIndex = html.indexOf('href="/_vf/css/abc123.css"');
      const bodyIndex = html.indexOf("<body>");
      assertEquals(importMapIndex > 0, true);
      assertEquals(stylesheetIndex > importMapIndex, true);
      assertEquals(bodyIndex > stylesheetIndex, true);
    });

    it("injects head assets before body content when head and body tags are omitted", () => {
      const html = injectHTMLContent(
        "<!DOCTYPE html><html><title>Page</title><main>Page</main></html>",
        "",
        minMeta,
        {
          mode: "production",
          environment: "production",
          slug: "test",
          importMapJson: '{"imports":{}}',
          projectStylesheetHref: "/_vf/css/abc123.css",
        },
      );

      const importMapIndex = html.indexOf('type="importmap"');
      const stylesheetIndex = html.indexOf('href="/_vf/css/abc123.css"');
      const mainIndex = html.indexOf("<main>");
      assertEquals(importMapIndex > 0, true);
      assertEquals(stylesheetIndex > importMapIndex, true);
      assertEquals(mainIndex > stylesheetIndex, true);
    });

    it("rejects malformed prebuilt import-map JSON", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            importMapJson: '{"imports":',
          }),
        Error,
        "import map",
      );
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
          pagePath: "app/page.tsx",
          isClientPage: true,
        },
      );

      const hydrationData = extractHydrationData(html);
      assertEquals(hydrationData.pagePath, "app/page.tsx");
      assertEquals(hydrationData.clientModuleStrategy, "rsc-module");
    });

    it("rejects absolute paths when no project root is available", () => {
      let threw = false;
      try {
        injectHTMLContent(baseTemplate, "", minMeta, {
          mode: "production",
          slug: "test",
          pagePath: "/app/page.tsx",
          isClientPage: true,
        });
      } catch (error) {
        threw = error instanceof Error && error.message.includes("Unsafe page path");
      }

      assertEquals(threw, true);
    });

    it("rejects deeply encoded traversal when no project root is available", () => {
      let traversal = "%2e%2e";
      for (let layer = 0; layer < 12; layer++) {
        traversal = traversal.replaceAll("%", "%25");
      }

      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            pagePath: `pages/${traversal}/private.tsx`,
            isClientPage: true,
          }),
        Error,
        "Unsafe page path",
      );
    });

    it("seeds route params into client-page hydration data (issue #2741)", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "docs/guides/intro",
          pagePath: "app/page.tsx",
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
          pagePath: "app/page.tsx",
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
          pagePath: "app/page.tsx",
          isClientPage: true,
        },
      );

      assertEquals(extractHydrationData(html).params, {});
    });

    it("rejects excessive client-page route params before serialization", () => {
      const params = Object.fromEntries(
        Array.from({ length: 101 }, (_, index) => [`param-${index}`, "value"]),
      );

      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            pagePath: "pages/test.tsx",
            isClientPage: true,
            params,
          }),
        Error,
        "params exceed the entry limit",
      );
    });

    it("converts inaccessible client-page route params into validation failures", () => {
      const params = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });

      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            pagePath: "pages/test.tsx",
            isClientPage: true,
            params,
          }),
        Error,
        "params cannot be inspected",
      );
    });

    it("rejects oversized client-page hydration payloads", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            pagePath: "app/page.tsx",
            isClientPage: true,
            params: { value: "x".repeat(4 * 1024 * 1024) },
          }),
        Error,
        "params",
      );
    });

    it("keeps production client-page injection on the RSC client boot script", () => {
      const html = injectHTMLContent(
        baseTemplate,
        "<p>content</p>",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "app/page.tsx",
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
          pagePath: "app/page.tsx",
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
          pagePath: "app/page.tsx",
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
          pagePath: "pages/index.tsx",
          sourceHash: "abc123",
        },
      );

      assertEquals(html.includes("studio-bridge.js"), true);
      assertEquals(html.includes('"pagePath":"pages/index.tsx"'), true);
      assertEquals(html.includes('window.__VERYFRONT_SOURCE_HASH__="abc123"'), true);
    });

    it("injects hydration and Studio scripts after raw-text body-like text", () => {
      const rawScript = '<script>globalThis.example = "</body>";</script>';
      const rawStyle = '<style>main::after { content: "</body>"; }</style>';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head></head><body>${rawScript}${rawStyle}<main>Page</main></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "pages/index.tsx",
          isClientPage: true,
          studioEmbed: true,
          projectId: "p1",
          pageId: "pg1",
          sourceHash: "abc123",
        },
      );

      const rawScriptEnd = html.indexOf(rawScript) + rawScript.length;
      const rawStyleEnd = html.indexOf(rawStyle) + rawStyle.length;
      const contentEnd = html.indexOf("</main>") + "</main>".length;
      const hydrationIndex = html.indexOf('id="veryfront-hydration-data"');
      const clientIndex = html.indexOf('src="/_veryfront/rsc/client.js"');
      const sourceHashIndex = html.indexOf("window.__VERYFRONT_SOURCE_HASH__");
      const configIndex = html.indexOf("window.__VF_BRIDGE_CONFIG__");
      const bridgeIndex = html.indexOf('src="/_veryfront/studio-bridge.js"');
      const bodyCloseIndex = html.lastIndexOf("</body>");

      assertEquals(html.includes(rawScript), true);
      assertEquals(html.includes(rawStyle), true);
      assertEquals(
        hydrationIndex > rawScriptEnd && hydrationIndex > rawStyleEnd &&
          hydrationIndex > contentEnd,
        true,
      );
      assertEquals(clientIndex > hydrationIndex, true);
      assertEquals(sourceHashIndex > clientIndex, true);
      assertEquals(configIndex > sourceHashIndex, true);
      assertEquals(bridgeIndex > configIndex, true);
      assertEquals(bodyCloseIndex > bridgeIndex, true);
    });

    it("skips SVG CDATA when locating the body end", () => {
      const foreignData = "<svg><![CDATA[a > </body> still-data]]></svg>";
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head></head><body>${foreignData}<main>Page</main></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "pages/index.tsx",
          isClientPage: true,
          studioEmbed: true,
          projectId: "p1",
          pageId: "pg1",
        },
      );

      const foreignDataEnd = html.indexOf(foreignData) + foreignData.length;
      const contentEnd = html.indexOf("</main>") + "</main>".length;
      const hydrationIndex = html.indexOf('id="veryfront-hydration-data"');
      const clientIndex = html.indexOf('src="/_veryfront/rsc/client.js"');
      const configIndex = html.indexOf("window.__VF_BRIDGE_CONFIG__");
      const bridgeIndex = html.indexOf('src="/_veryfront/studio-bridge.js"');

      assertEquals(html.includes(foreignData), true);
      assertEquals(hydrationIndex > foreignDataEnd && hydrationIndex > contentEnd, true);
      assertEquals(clientIndex > hydrationIndex, true);
      assertEquals(configIndex > clientIndex, true);
      assertEquals(bridgeIndex > configIndex, true);
      assertEquals(html.lastIndexOf("</body>") > bridgeIndex, true);
    });

    it("injects hydration and Studio scripts before html when the body end tag is omitted", () => {
      const html = injectHTMLContent(
        "<!DOCTYPE html><html><head></head><body><main>Page</main></html>",
        "",
        minMeta,
        {
          mode: "production",
          slug: "test",
          pagePath: "pages/index.tsx",
          isClientPage: true,
          studioEmbed: true,
          projectId: "p1",
          pageId: "pg1",
        },
      );

      const contentEnd = html.indexOf("</main>") + "</main>".length;
      const hydrationIndex = html.indexOf('id="veryfront-hydration-data"');
      const clientIndex = html.indexOf('src="/_veryfront/rsc/client.js"');
      const configIndex = html.indexOf("window.__VF_BRIDGE_CONFIG__");
      const bridgeIndex = html.indexOf('src="/_veryfront/studio-bridge.js"');
      const htmlCloseIndex = html.indexOf("</html>");

      assertEquals(hydrationIndex > contentEnd, true);
      assertEquals(clientIndex > hydrationIndex, true);
      assertEquals(configIndex > clientIndex, true);
      assertEquals(bridgeIndex > configIndex, true);
      assertEquals(htmlCloseIndex > bridgeIndex, true);
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

    it("does not mistake stylesheet-like raw text for a loaded stylesheet", () => {
      const fakeLink = '<link rel="stylesheet" id="vf-tailwind-css">';
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head><script>const fake = ${
          JSON.stringify(fakeLink)
        };</script></head><body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          environment: "preview",
          slug: "test",
        },
      );

      assertEquals(html.includes("/_vf_styles/styles.css?t="), true);
      assertEquals(html.match(/<link[^>]+id="vf-tailwind-css"/g)?.length, 1);
    });

    it("recognizes an existing framework stylesheet with legal attribute syntax", () => {
      const existing =
        "<link href = /_vf_styles/styles.css?t=1 id = vf-tailwind-css rel = stylesheet>";
      const html = injectHTMLContent(
        `<!DOCTYPE html><html><head>${existing}</head><body></body></html>`,
        "",
        minMeta,
        {
          mode: "production",
          environment: "preview",
          slug: "test",
        },
      );

      assertEquals(html.match(/\/_vf_styles\/styles\.css/g)?.length, 1);
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
      assertEquals(html.match(/\/_vf\/css\/abc123\.css/g)?.length, 1);
    });

    it("rejects malformed framework stylesheet URLs", () => {
      assertThrows(
        () =>
          injectHTMLContent(baseTemplate, "", minMeta, {
            mode: "production",
            slug: "test",
            projectStylesheetHref: '/_vf/css/file.css" onload="globalThis.pwned=1',
          }),
        Error,
        "stylesheet URL",
      );
    });

    it("propagates CSP nonces to metadata scripts and styles", () => {
      const html = injectHTMLContent(
        "<html><head>{{ scripts }}{{ styles }}</head><body></body></html>",
        "",
        {
          scripts: [{ src: "/app.js" }, { content: "globalThis.ready = true" }],
          styles: [{ content: "body { color: black; }" }],
        },
        { mode: "production", slug: "test", nonce: "nonce-123" },
      );

      assertEquals(html.includes('src="/app.js" nonce="nonce-123"'), true);
      assertEquals(html.includes('<script nonce="nonce-123"'), true);
      assertEquals(html.includes('<style nonce="nonce-123"'), true);
    });
  });
});
