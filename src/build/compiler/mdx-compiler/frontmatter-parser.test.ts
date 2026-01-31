import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractExports } from "./frontmatter-parser.ts";

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
  });
});
