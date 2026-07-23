import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extract, test } from "./front-matter-yaml.ts";

describe("platform/compat/std/front-matter-yaml", () => {
  describe("test", () => {
    it("should return true for text with YAML front matter", () => {
      assertEquals(test("---\ntitle: Hello\n---\nBody"), true);
    });

    it("should return true for text with CRLF front matter", () => {
      assertEquals(test("---\r\ntitle: Hello\r\n---\r\nBody"), true);
    });

    it("should return false for text without front matter", () => {
      assertEquals(test("No front matter here"), false);
    });

    it("should return false for empty string", () => {
      assertEquals(test(""), false);
    });

    it("should return false for dashes not at the start", () => {
      assertEquals(test("Some text\n---\ntitle: Hello\n---"), false);
    });
  });

  describe("extract", () => {
    it("should extract YAML front matter and body", () => {
      const input = "---\ntitle: Hello World\nauthor: Test\n---\nThis is the body.";
      const result = extract(input);

      assertEquals(result.attrs.title, "Hello World");
      assertEquals(result.attrs.author, "Test");
      assertEquals(result.body.trim(), "This is the body.");
    });

    it("should return empty attrs for text without front matter", () => {
      const result = extract("Just plain text");
      assertEquals(Object.keys(result.attrs).length, 0);
      assertEquals(result.body.trim(), "Just plain text");
    });

    it("should handle empty front matter", () => {
      const result = extract("---\n---\nBody text");
      assertEquals(Object.keys(result.attrs).length, 0);
      assertEquals(result.body.trim(), "Body text");
    });

    it("should handle typed extraction", () => {
      interface MyFrontMatter {
        title: string;
        count: number;
      }
      const input = "---\ntitle: Typed\ncount: 42\n---\nContent";
      const result = extract<MyFrontMatter>(input);

      assertEquals(result.attrs.title, "Typed");
      assertEquals(result.attrs.count, 42);
    });

    it("should handle complex YAML values", () => {
      const input = "---\ntags:\n  - one\n  - two\nnested:\n  key: value\n---\nBody";
      const result = extract<{ tags: string[]; nested: { key: string } }>(input);

      assertEquals(Array.isArray(result.attrs.tags), true);
      assertEquals(result.attrs.tags[0], "one");
      assertEquals(result.attrs.tags[1], "two");
      assertEquals(result.attrs.nested.key, "value");
    });

    it("should return frontMatter string", () => {
      const input = "---\ntitle: Hello\n---\nBody";
      const result = extract(input);
      assertEquals(typeof result.frontMatter, "string");
    });

    it("only treats a delimiter on its own line as the closing delimiter", () => {
      const input = "---\ndescription: value---\nBody without a closing delimiter";
      const result = extract(input);

      assertEquals(result.attrs, {});
      assertEquals(result.body, input);
      assertEquals(result.frontMatter, "");
    });

    it("keeps delimiter text inside YAML values until a closing delimiter line", () => {
      const input = "---\ndescription: value---inside\n---\nBody";
      const result = extract(input);

      assertEquals(result.attrs.description, "value---inside");
      assertEquals(result.body, "Body");
    });

    it("accepts a UTF-8 BOM before the opening delimiter", () => {
      const result = extract("\ufeff---\ntitle: BOM\n---\nBody");

      assertEquals(result.attrs.title, "BOM");
      assertEquals(result.body, "Body");
      assertEquals(test("\ufeff---\ntitle: BOM\n---\nBody"), true);
    });

    it("accepts trailing horizontal whitespace on a closing delimiter line", () => {
      const result = extract("---\ntitle: Spaced\n--- \t\nBody");

      assertEquals(result.attrs.title, "Spaced");
      assertEquals(result.body, "Body");
    });
  });
});
