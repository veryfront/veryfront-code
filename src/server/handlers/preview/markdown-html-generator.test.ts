import { assert } from "#veryfront/testing/assert.ts";
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

  it("prefers vf_file_id for bridge page id when present", () => {
    const html = generateMarkdownHtml(
      makeOptions({
        url: new URL(
          "http://localhost/test.md?studio_embed=true&vf_file_id=9c7ba88d-fef9-43c0-9f5d-7f1125536d0f",
        ),
      }),
    );

    assert(
      html.includes('const PAGE_ID = "9c7ba88d-fef9-43c0-9f5d-7f1125536d0f";'),
    );
  });

  it("prefers vf_project_id for bridge project id when present", () => {
    const html = generateMarkdownHtml(
      makeOptions({
        url: new URL(
          "http://localhost/test.md?studio_embed=true&vf_project_id=95c93d5a-51a1-4ade-b055-72162cf0a891",
        ),
      }),
    );

    assert(
      html.includes(
        'const PROJECT_ID = "95c93d5a-51a1-4ade-b055-72162cf0a891";',
      ),
    );
  });
});
