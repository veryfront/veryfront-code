import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { wrapInHTML } from "./html-wrapper.ts";
import type { HTMLWrapOptions } from "./types.ts";

describe("html-wrapper", () => {
  describe("wrapInHTML", () => {
    it("should generate complete HTML5 document", () => {
      const options: HTMLWrapOptions = {
        title: "Test Page",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Content</div>", options);

      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain('<html lang="en">');
      expect(result).toContain("</html>");
      expect(result).toContain("<head>");
      expect(result).toContain("</head>");
      expect(result).toContain("<body>");
      expect(result).toContain("</body>");
    });

    it("should include page title", () => {
      const options: HTMLWrapOptions = {
        title: "My App",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain("<title>My App</title>");
    });

    it("should include charset meta tag", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<meta charset="UTF-8">');
    });

    it("should include viewport meta tag", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      );
    });

    it("should include custom meta tags", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {
          description: "Test description",
          keywords: "test, keywords",
        },
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<meta name="description" content="Test description">');
      expect(result).toContain('<meta name="keywords" content="test, keywords">');
    });

    it("should include link tags", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [
          { rel: "stylesheet", href: "/styles.css" },
          { rel: "icon", href: "/favicon.ico" },
        ],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<link rel="stylesheet" href="/styles.css">');
      expect(result).toContain('<link rel="icon" href="/favicon.ico">');
    });

    it("should include head scripts", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [{ src: "/script.js" }],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/script.js"></script>');
    });

    it("should include head scripts with type", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [{ src: "/module.js", type: "module" }],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/module.js" type="module"></script>');
    });

    it("should wrap content in root div", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<h1>Hello</h1>", options);

      expect(result).toContain('<div id="root"><h1>Hello</h1></div>');
    });

    it("should include bootstrap scripts in body", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: ["/app.js", "/vendor.js"],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/app.js" async></script>');
      expect(result).toContain('<script src="/vendor.js" async></script>');
    });

    it("should add nonce to head scripts when provided", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [{ src: "/script.js" }],
        bootstrapScripts: [],
        nonce: "abc123",
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/script.js" nonce="abc123"></script>');
    });

    it("should add nonce to bootstrap scripts when provided", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: ["/app.js"],
        nonce: "xyz789",
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/app.js" nonce="xyz789" async></script>');
    });

    it("should handle empty content", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("", options);

      expect(result).toContain('<div id="root"></div>');
    });

    it("should handle empty meta object", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      const metaCount = (result.match(/<meta/g) || []).length;
      expect(metaCount).toBe(2);
    });

    it("should handle empty links array", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).not.toContain("<link");
    });

    it("should handle empty scripts array", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      const headEndIndex = result.indexOf("</head>");
      const head = result.substring(0, headEndIndex);
      expect(head).not.toContain("<script");
    });

    it("should handle empty bootstrap scripts array", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      const bodyStartIndex = result.indexOf("<body>");
      const body = result.substring(bodyStartIndex);
      expect(body).not.toContain("<script");
    });

    it("should escape special characters in title", () => {
      const options: HTMLWrapOptions = {
        title: "Test & <Title>",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain("<title>Test & <Title></title>");
    });

    it("should preserve content HTML structure", () => {
      const content = `
        <div class="container">
          <h1>Hello</h1>
          <p>World</p>
        </div>
      `;
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML(content, options);

      expect(result).toContain("<h1>Hello</h1>");
      expect(result).toContain("<p>World</p>");
      expect(result).toContain('class="container"');
    });

    it("should handle complex meta tags", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {
          "og:title": "Open Graph Title",
          "og:description": "Open Graph Description",
          "twitter:card": "summary_large_image",
        },
        links: [],
        scripts: [],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<meta name="og:title" content="Open Graph Title">');
      expect(result).toContain('<meta name="og:description" content="Open Graph Description">');
      expect(result).toContain('<meta name="twitter:card" content="summary_large_image">');
    });

    it("should handle multiple script types", () => {
      const options: HTMLWrapOptions = {
        title: "Test",
        meta: {},
        links: [],
        scripts: [
          { src: "/regular.js" },
          { src: "/module.js", type: "module" },
          { src: "/importmap.js", type: "importmap" },
        ],
        bootstrapScripts: [],
      };
      const result = wrapInHTML("<div>Test</div>", options);

      expect(result).toContain('<script src="/regular.js"></script>');
      expect(result).toContain('<script src="/module.js" type="module"></script>');
      expect(result).toContain('<script src="/importmap.js" type="importmap"></script>');
    });

    it("should handle complete real-world example", () => {
      const options: HTMLWrapOptions = {
        title: "My React App",
        meta: {
          description: "A React application",
          viewport: "width=device-width, initial-scale=1",
        },
        links: [
          { rel: "stylesheet", href: "/styles.css" },
          { rel: "icon", href: "/favicon.ico" },
        ],
        scripts: [
          { src: "/config.js" },
        ],
        bootstrapScripts: [
          "/runtime.js",
          "/vendor.js",
          "/app.js",
        ],
        nonce: "nonce-123",
      };
      const content = '<div class="app"><h1>Welcome</h1></div>';
      const result = wrapInHTML(content, options);

      expect(result).toContain("<title>My React App</title>");
      expect(result).toContain('<link rel="stylesheet" href="/styles.css">');
      expect(result).toContain('<script src="/config.js" nonce="nonce-123"></script>');
      expect(result).toContain('<div id="root"><div class="app"><h1>Welcome</h1></div></div>');
      expect(result).toContain('<script src="/runtime.js" nonce="nonce-123" async></script>');
      expect(result).toContain('<script src="/vendor.js" nonce="nonce-123" async></script>');
      expect(result).toContain('<script src="/app.js" nonce="nonce-123" async></script>');
    });
  });
});
