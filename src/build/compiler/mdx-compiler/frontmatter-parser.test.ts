import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExports, parseFrontmatter } from "./frontmatter-parser.ts";

describe("build/compiler/mdx-compiler/frontmatter-parser", () => {
  describe("extractExports", () => {
    const cases: Array<{
      name: string;
      code: string;
      key: string;
      value: unknown;
    }> = [
      {
        name: "should extract string exports",
        code: 'export const title = "Hello World"',
        key: "title",
        value: "Hello World",
      },
      {
        name: "should extract boolean exports",
        code: "export const draft = true",
        key: "draft",
        value: true,
      },
      {
        name: "should extract number exports",
        code: "export const order = 42",
        key: "order",
        value: 42,
      },
      {
        name: "should extract null exports",
        code: "export const value = null",
        key: "value",
        value: null,
      },
      {
        name: "should extract object exports",
        code: 'export const meta = {"key": "val"}',
        key: "meta",
        value: { key: "val" },
      },
      {
        name: "should extract array exports",
        code: 'export const tags = ["a", "b"]',
        key: "tags",
        value: ["a", "b"],
      },
    ];

    for (const { name, code, key, value } of cases) {
      it(name, () => {
        const { frontmatter } = extractExports(code);
        assertEquals(frontmatter[key], value);
      });
    }

    it("should extract multiple exports", () => {
      const code = [
        'export const title = "Page"',
        "export const draft = false",
        "",
        "# Content here",
      ].join("\n");

      const { frontmatter, content } = extractExports(code);

      assertEquals(frontmatter.title, "Page");
      assertEquals(frontmatter.draft, false);
      assertEquals(content.includes("# Content here"), true);
    });

    it("should remove export lines from content", () => {
      const code = 'export const title = "test"\n\nHello';
      const { content } = extractExports(code);

      assertEquals(content.includes("export const title"), false);
      assertEquals(content.includes("Hello"), true);
    });

    it("should handle content with no exports", () => {
      const code = "# Just markdown\n\nNo exports here.";
      const { frontmatter, content } = extractExports(code);

      assertEquals(Object.keys(frontmatter).length, 0);
      assertEquals(content, code);
    });

    it("should handle single-quoted string exports", () => {
      const code = "export const name = 'test'";
      const { frontmatter } = extractExports(code);
      assertEquals(frontmatter.name, "test");
    });

    it("should handle export with complex value that is not valid JSON", () => {
      const code = "export const fn = someFunction()";
      const { frontmatter } = extractExports(code);
      assertEquals(frontmatter.fn, "someFunction()");
    });
  });

  describe("parseFrontmatter", () => {
    it("should parse valid YAML frontmatter", async () => {
      const content = "---\ntitle: Hello World\ndraft: true\n---\n# Content";
      const result = await parseFrontmatter(content);
      assertEquals(result.frontmatter.title, "Hello World");
      assertEquals(result.frontmatter.draft, true);
      assertEquals(result.content.includes("# Content"), true);
    });

    it("should return empty frontmatter for content without frontmatter", async () => {
      const content = "# Just a heading\n\nSome text.";
      const result = await parseFrontmatter(content);
      assertEquals(Object.keys(result.frontmatter).length, 0);
      assertEquals(result.content, content);
    });

    it("should handle frontmatter with multiple fields", async () => {
      const content = "---\ntitle: My Page\nauthor: Test\ndate: 2024-01-01\n---\nBody text";
      const result = await parseFrontmatter(content);
      assertEquals(result.frontmatter.title, "My Page");
      assertEquals(result.frontmatter.author, "Test");
    });

    it("should handle empty frontmatter block", async () => {
      const content = "---\n---\nBody text";
      const result = await parseFrontmatter(content);
      assertEquals(result.content.includes("Body text"), true);
    });
  });
});
