import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";

describe("tag-generators", () => {
  describe("generateMetaTags", () => {
    it("should always include charset meta tag", () => {
      assertStringIncludes(generateMetaTags({}), '<meta charset="UTF-8">');
    });

    it("should include default viewport when not specified", () => {
      const result = generateMetaTags({});
      assertStringIncludes(result, 'name="viewport"');
      assertStringIncludes(result, "width=device-width, initial-scale=1.0");
    });

    it("should use custom viewport when specified", () => {
      assertStringIncludes(
        generateMetaTags({
          viewport: "width=device-width, initial-scale=1.0, maximum-scale=1.0",
        }),
        "maximum-scale=1.0",
      );
    });

    it("should include description meta tag", () => {
      const result = generateMetaTags({ description: "Test description" });
      assertStringIncludes(result, 'name="description"');
      assertStringIncludes(result, 'content="Test description"');
    });

    it("should escape special characters in description", () => {
      const result = generateMetaTags({
        description: 'Test "quoted" & <special>',
      });
      assertStringIncludes(result, "&quot;quoted&quot;");
      assertStringIncludes(result, "&amp;");
      assertStringIncludes(result, "&lt;special&gt;");
    });

    it("should include custom meta tags", () => {
      const result = generateMetaTags({
        meta: [
          { name: "author", content: "John Doe" },
          { property: "og:title", content: "Open Graph Title" },
        ],
      });
      assertStringIncludes(result, 'name="author"');
      assertStringIncludes(result, 'content="John Doe"');
      assertStringIncludes(result, 'property="og:title"');
    });

    it("should include theme-color meta tag", () => {
      const result = generateMetaTags({ themeColor: "#ffffff" });
      assertStringIncludes(result, 'name="theme-color"');
      assertStringIncludes(result, 'content="#ffffff"');
    });

    it("rejects excessive tag entries at direct runtime boundaries", () => {
      assertThrows(
        () =>
          generateMetaTags({
            meta: Array.from(
              { length: 101 },
              (_, index) => ({ name: `entry-${index}`, content: "value" }),
            ),
          }),
        Error,
        "entry limit",
      );
    });

    it("rejects excessive attributes instead of silently truncating them", () => {
      const attributes = Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [`data-value-${index}`, "value"]),
      );

      assertThrows(
        () =>
          generateMetaTags({
            meta: [{ name: "custom", content: "value", ...attributes }],
          } as never),
        Error,
        "attribute limit",
      );
    });

    it("converts inaccessible tag attributes into validation failures", () => {
      const attributes = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });

      assertThrows(
        () => generateMetaTags({ meta: [attributes] } as never),
        Error,
        "tag attributes cannot be inspected",
      );
    });

    it("does not execute tag attribute accessors", () => {
      let accessorCalls = 0;
      const attributes: Record<string, unknown> = { name: "description" };
      Object.defineProperty(attributes, "content", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "Private content";
        },
      });

      assertThrows(
        () => generateMetaTags({ meta: [attributes] } as never),
        Error,
        "tag attributes cannot be inspected",
      );
      assertEquals(accessorCalls, 0);
    });
  });

  describe("generateLinkTags", () => {
    it("should return empty string when no links", () => {
      assertEquals(generateLinkTags({}), "");
    });

    it("should generate link tags", () => {
      const result = generateLinkTags({
        links: [{ rel: "stylesheet", href: "/styles.css" }],
      });
      assertStringIncludes(result, 'rel="stylesheet"');
      assertStringIncludes(result, 'href="/styles.css"');
    });

    it("should add crossorigin for font preloads", () => {
      assertStringIncludes(
        generateLinkTags({
          links: [
            {
              rel: "preload",
              as: "font",
              href: "/font.woff2",
              type: "font/woff2",
            },
          ],
        }),
        'crossorigin="anonymous"',
      );
    });

    it("should not override existing crossorigin", () => {
      assertStringIncludes(
        generateLinkTags({
          links: [
            {
              rel: "preload",
              as: "font",
              href: "/font.woff2",
              crossorigin: "use-credentials",
            },
          ],
        }),
        'crossorigin="use-credentials"',
      );
    });

    it("should generate icon tags", () => {
      const result = generateLinkTags({
        icons: [
          { href: "/favicon.ico" },
          {
            href: "/apple-touch-icon.png",
            rel: "apple-touch-icon",
            sizes: "180x180",
          },
        ],
      });
      assertStringIncludes(result, 'rel="icon"');
      assertStringIncludes(result, 'href="/favicon.ico"');
      assertStringIncludes(result, 'rel="apple-touch-icon"');
      assertStringIncludes(result, 'sizes="180x180"');
    });

    it("drops executable event-handler attributes", () => {
      const result = generateLinkTags({
        links: [{ rel: "stylesheet", href: "/safe.css", onload: "globalThis.pwned=1" }],
        icons: [{ href: "/favicon.ico", onerror: "globalThis.pwned=1" }],
      } as never);

      assertEquals(result.includes("onload"), false);
      assertEquals(result.includes("onerror"), false);
    });
  });

  describe("generateScriptTags", () => {
    it("should return empty string when no scripts", () => {
      assertEquals(generateScriptTags({}), "");
    });

    it("should generate external script tags", () => {
      const result = generateScriptTags({
        scripts: [{ src: "/app.js", async: "true" }],
      });
      assertStringIncludes(result, 'src="/app.js"');
      assertStringIncludes(result, 'async="true"');
    });

    it("should generate inline script tags", () => {
      const result = generateScriptTags({
        scripts: [{ content: "console.log('hello');" }],
      });
      assertStringIncludes(result, "console.log('hello');");
      assertStringIncludes(result, "</script>");
    });

    it("neutralizes closing script tags in inline script content", () => {
      const result = generateScriptTags({
        scripts: [{ content: `globalThis.value="</script><script>alert(1)</script>"` }],
      });

      assertEquals(result.includes("</script><script>alert(1)</script>"), false);
      assertStringIncludes(result, `<\\/script><script>alert(1)<\\/script>`);
      assertStringIncludes(result, "</script>");
    });

    it("should add nonce to inline scripts", () => {
      assertStringIncludes(
        generateScriptTags({ scripts: [{ content: "alert(1);" }] }, "abc123"),
        'nonce="abc123"',
      );
    });

    it("adds the nonce to external scripts", () => {
      assertStringIncludes(
        generateScriptTags({ scripts: [{ src: "/app.js" }] }, "abc123"),
        'nonce="abc123"',
      );
    });

    it("should prioritize src over content", () => {
      const result = generateScriptTags({
        scripts: [{ content: "alert(1);", src: "/script.js" }],
      });
      assertStringIncludes(result, 'src="/script.js"');
      assertEquals(result.includes("alert(1);"), false);
    });

    it("should handle module scripts", () => {
      assertStringIncludes(
        generateScriptTags({
          scripts: [{ src: "/module.js", type: "module" }],
        }),
        'type="module"',
      );
    });

    it("drops executable event-handler attributes", () => {
      const result = generateScriptTags({
        scripts: [{ src: "/app.js", onerror: "globalThis.pwned=1" }],
      } as never);

      assertEquals(result.includes("onerror"), false);
    });
  });

  describe("generateStyleTags", () => {
    it("should return empty string when no styles", () => {
      assertEquals(generateStyleTags({}), "");
    });

    it("should generate external stylesheet links", () => {
      const result = generateStyleTags({
        styles: [{ href: "/styles.css" }],
      });
      assertStringIncludes(result, 'rel="stylesheet"');
      assertStringIncludes(result, 'href="/styles.css"');
    });

    it("should generate inline style tags", () => {
      const result = generateStyleTags({
        styles: [{ content: "body { color: red; }" }],
      });
      assertStringIncludes(result, "body { color: red; }");
      assertStringIncludes(result, "</style>");
    });

    it("neutralizes closing style tags in inline style content", () => {
      const result = generateStyleTags({
        styles: [{ content: `body:after{content:"</style><style>body{color:red}</style>"}` }],
      });

      assertEquals(result.includes("</style><style>body{color:red}</style>"), false);
      assertStringIncludes(result, `<\\/style><style>body{color:red}<\\/style>`);
      assertStringIncludes(result, "</style>");
    });

    it("should add nonce to inline styles", () => {
      assertStringIncludes(
        generateStyleTags(
          { styles: [{ content: ".test { color: blue; }" }] },
          "xyz789",
        ),
        'nonce="xyz789"',
      );
    });

    it("adds the nonce to external stylesheets", () => {
      assertStringIncludes(
        generateStyleTags({ styles: [{ href: "/styles.css" }] }, "xyz789"),
        'nonce="xyz789"',
      );
    });

    it("enforces stylesheet semantics and drops event handlers", () => {
      const result = generateStyleTags({
        styles: [{
          href: "/styles.css",
          rel: "alternate",
          onload: "globalThis.pwned=1",
        }],
      } as never);

      assertEquals(result.match(/\brel=/g)?.length, 1);
      assertStringIncludes(result, 'rel="stylesheet"');
      assertEquals(result.includes("alternate"), false);
      assertEquals(result.includes("onload"), false);
    });

    it("ignores malformed tag entries at runtime", () => {
      assertEquals(generateStyleTags({ styles: [null] } as never), "");
      assertEquals(generateScriptTags({ scripts: [null] } as never), "");
      assertEquals(generateLinkTags({ links: [null], icons: [null] } as never), "");
      assertEquals(
        generateMetaTags({ meta: { invalid: true } } as never).includes("invalid"),
        false,
      );
    });

    it("should handle media attribute", () => {
      assertStringIncludes(
        generateStyleTags({
          styles: [{ href: "/print.css", media: "print" }],
        }),
        'media="print"',
      );
    });
  });
});
