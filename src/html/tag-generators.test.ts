import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";

describe("tag-generators", () => {
  it("does not let structured metadata spoof framework head ownership", () => {
    const markerAttributes = {
      "DATA-VF-HEAD": "spoofed",
      "data-vf-react-head": "spoofed",
      "Data-Vf-React-Head-Owner": "spoofed",
      "data-vf-shell-head": "spoofed",
      "data-vf-route-head": "spoofed",
      "data-veryfront-managed": "spoofed",
      "DATA-VF-HASH": "spoofed",
    };
    const output = [
      generateMetaTags({
        meta: [{ name: "author", content: "A", ...markerAttributes }],
      } as never),
      generateLinkTags({
        links: [{ rel: "preload", href: "/asset", ...markerAttributes }],
      } as never),
      generateScriptTags({
        scripts: [{ src: "/asset.js", ...markerAttributes }],
      } as never),
      generateStyleTags({
        styles: [{ content: ".safe{}", ...markerAttributes }],
      } as never),
    ].join("\n");

    assertEquals(output.includes("spoofed"), false);
  });

  it("does not let structured metadata smuggle inline event handlers into the head", () => {
    const handlerAttributes = {
      onload: "alert(1)",
      onClick: "alert(2)",
      ONERROR: "alert(3)",
    };
    const output = [
      generateMetaTags({
        meta: [{ name: "author", content: "A", ...handlerAttributes }],
      } as never),
      generateLinkTags({
        links: [{ rel: "preload", href: "/asset", ...handlerAttributes }],
      } as never),
      generateScriptTags({
        scripts: [{ src: "/asset.js", ...handlerAttributes }],
      } as never),
      generateStyleTags({
        styles: [{ content: ".safe{}", ...handlerAttributes }],
      } as never),
    ].join("\n");

    assertEquals(
      output.includes("alert("),
      false,
      "inline event handler values must never reach the head",
    );
    assertEquals(
      /\son[a-z]+=/i.test(output),
      false,
      "no on* attribute may be serialized into a head tag",
    );
  });

  it("marks every structured route head entry except charset as shell-owned", () => {
    const metas = generateMetaTags({
      description: "Description",
      meta: [
        { name: "author", content: "Author" },
        { property: "og:title", content: "Title" },
        { property: "og:image", content: "/image.png" },
      ],
    });
    const links = generateLinkTags({
      links: [
        { rel: "canonical", href: "https://example.com/" },
        { rel: "stylesheet", href: "/app.css" },
      ],
      icons: [{ href: "/favicon.ico" }],
    });

    assertEquals(
      /<meta charset="UTF-8"[^>]*data-vf-shell-head/.test(metas),
      false,
    );
    assertEquals(
      /<meta name="viewport"[^>]*data-vf-shell-head="true"/.test(metas),
      true,
    );
    assertEquals(
      /<meta name="description"[^>]*data-vf-shell-head="true"/.test(metas),
      true,
    );
    assertEquals(
      /<meta name="author"[^>]*data-vf-shell-head/.test(metas),
      true,
    );
    assertEquals(
      /<meta property="og:title"[^>]*data-vf-shell-head="true"/.test(metas),
      true,
    );
    assertEquals(
      /<meta property="og:image"[^>]*data-vf-shell-head/.test(metas),
      true,
    );
    assertEquals(
      /<link rel="canonical"[^>]*data-vf-shell-head="true"/.test(links),
      true,
    );
    assertEquals(
      /<link rel="stylesheet"[^>]*data-vf-shell-head/.test(links),
      true,
    );
    assertEquals(
      /<link rel="icon"[^>]*data-vf-shell-head/.test(links),
      true,
    );
  });

  it("keeps document encoding exclusively shell-owned", () => {
    const metas = generateMetaTags({
      meta: [
        { CHARSET: "ISO-8859-1" },
        { "HTTP-EQUIV": "Content-Type", content: "text/html; charset=windows-1252" },
      ],
    } as never);

    assertEquals((metas.match(/<meta\b[^>]*\bcharset=/gi) ?? []).length, 1);
    assertEquals(metas.includes("ISO-8859-1"), false);
    assertEquals(metas.includes("windows-1252"), false);
  });

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
