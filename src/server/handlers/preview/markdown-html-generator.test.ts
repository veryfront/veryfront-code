import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateMarkdownHtml } from "./markdown-html-generator.ts";

function makeOptions(overrides: Partial<Parameters<typeof generateMarkdownHtml>[0]> = {}) {
  return {
    rawHtml: "<p>Hello</p>",
    title: "Test Page",
    description: "A test page",
    request: new Request("http://localhost/test.md"),
    url: new URL("http://localhost/test.md"),
    projectId: "test-project",
    filePath: "test.md",
    ...overrides,
  };
}

describe("generateMarkdownHtml", () => {
  describe("XSS prevention", () => {
    it("escapes HTML in title", () => {
      const html = generateMarkdownHtml(
        makeOptions({ title: '<script>alert("xss")</script>' }),
      );
      assert(!html.includes('<script>alert("xss")</script>'));
      assert(html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));
    });

    it("escapes HTML in description", () => {
      const html = generateMarkdownHtml(
        makeOptions({ description: '"><script>alert(1)</script>' }),
      );
      assert(!html.includes('"><script>alert(1)</script>'));
      assert(html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
    });

    it("escapes single quotes in title", () => {
      const html = generateMarkdownHtml(
        makeOptions({ title: "It's a test" }),
      );
      assert(html.includes("It&#39;s a test"));
    });
  });

  describe("theme detection", () => {
    it("applies light theme from query param", () => {
      const html = generateMarkdownHtml(
        makeOptions({ url: new URL("http://localhost/test.md?color_mode=light") }),
      );
      assert(html.includes('data-theme="light"'));
    });

    it("applies dark theme from query param", () => {
      const html = generateMarkdownHtml(
        makeOptions({ url: new URL("http://localhost/test.md?color_mode=dark") }),
      );
      assert(html.includes('data-theme="dark"'));
    });

    it("omits theme attrs when no preference", () => {
      const html = generateMarkdownHtml(makeOptions());
      assert(html.includes('<html lang="en">'));
    });
  });

  it("includes raw HTML content in article", () => {
    const html = generateMarkdownHtml(makeOptions({ rawHtml: "<h1>Hello</h1>" }));
    assert(html.includes("<h1>Hello</h1>"));
  });

  it("omits description meta tag when empty", () => {
    const html = generateMarkdownHtml(makeOptions({ description: "" }));
    assert(!html.includes('meta name="description"'));
  });
});
