import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractFrontmatter, extractMetadata, mergeFrontmatter } from "./extractor.ts";

describe("transforms/mdx/esm-module-loader/metadata/extractor", () => {
  describe("extractFrontmatter", () => {
    it("extracts frontmatter object", () => {
      const code = `export const frontmatter = { title: "Hello" };`;
      const result = extractFrontmatter(code);
      assertEquals(result?.title, "Hello");
    });

    it("returns undefined when no frontmatter", () => {
      assertEquals(extractFrontmatter("const x = 1;"), undefined);
    });

    it("handles nested frontmatter", () => {
      const code = `const frontmatter = { title: "Hi", meta: { description: "test" } };`;
      const result = extractFrontmatter(code);
      assertEquals(result?.title, "Hi");
    });

    it("returns undefined for malformed frontmatter", () => {
      const code = `const frontmatter = not_an_object;`;
      assertEquals(extractFrontmatter(code), undefined);
    });

    it("handles URL values without corrupting the colon", () => {
      // The old key-quoting regex matched `https:` inside the URL value as a
      // key and corrupted it.  The fix restricts quoting to {/,  positions.
      const code = `export const frontmatter = { url: "https://example.com" };`;
      const result = extractFrontmatter(code);
      assertEquals(result?.url, "https://example.com");
    });

    it("handles multiple keys with URL values", () => {
      const code =
        `export const frontmatter = { title: "Hello", link: "https://example.com/a:b" };`;
      const result = extractFrontmatter(code);
      assertEquals(result?.title, "Hello");
      assertEquals(result?.link, "https://example.com/a:b");
    });

    it("handles export const syntax", () => {
      const code = `export const frontmatter = { draft: true };`;
      const result = extractFrontmatter(code);
      assertEquals(result?.draft, true);
    });
  });

  describe("extractMetadata", () => {
    it("extracts title", () => {
      const code = `export const title = "My Page";`;
      const result = extractMetadata(code);
      assertEquals(result.title, "My Page");
    });

    it("extracts description", () => {
      const code = `const description = "A description";`;
      const result = extractMetadata(code);
      assertEquals(result.description, "A description");
    });

    it("extracts draft as boolean", () => {
      const code = `const draft = true;`;
      assertEquals(extractMetadata(code).draft, true);
    });

    it("extracts draft false", () => {
      const code = `const draft = false;`;
      assertEquals(extractMetadata(code).draft, false);
    });

    it("extracts layout as boolean true", () => {
      const code = `const layout = true;`;
      assertEquals(extractMetadata(code).layout, true);
    });

    it("extracts layout as boolean false", () => {
      const code = `const layout = false;`;
      assertEquals(extractMetadata(code).layout, false);
    });

    it("extracts layout as string", () => {
      const code = `const layout = "custom-layout";`;
      assertEquals(extractMetadata(code).layout, "custom-layout");
    });

    it("extracts date", () => {
      const code = `const date = "2024-01-01";`;
      assertEquals(extractMetadata(code).date, "2024-01-01");
    });

    it("extracts tags as array", () => {
      const code = `const tags = ["a", "b"];`;
      const result = extractMetadata(code);
      assertEquals(result.tags, ["a", "b"]);
    });

    it("extracts headings with nested structure (multiple objects)", () => {
      // Non-greedy [\s\S]*?] stopped at the first ] inside inner arrays.
      // extractBalancedBlock handles arbitrary nesting.
      const code = `const headings = [{id:"a",text:"A"},{id:"b",text:"B"}];`;
      const result = extractMetadata(code);
      assertEquals(Array.isArray(result.headings), true);
      assertEquals((result.headings as Array<{ id: string }>).length, 2);
    });

    it("extracts headings with children arrays (deeply nested)", () => {
      const code = `const headings = [{id:"h1",children:[{id:"h2"}]}];`;
      const result = extractMetadata(code);
      assertEquals(Array.isArray(result.headings), true);
      assertEquals((result.headings as Array<unknown>).length, 1);
    });

    it("extracts nested object", () => {
      const code = `const nested = {section:{items:[1,2]},count:2};`;
      const result = extractMetadata(code);
      assertEquals(typeof result.nested, "object");
    });

    it("returns empty object when no metadata found", () => {
      const result = extractMetadata("const x = 1;");
      assertEquals(Object.keys(result).length, 0);
    });

    it("extracts multiple metadata fields", () => {
      const code = `
const title = "Hello";
const description = "World";
const draft = false;
      `;
      const result = extractMetadata(code);
      assertEquals(result.title, "Hello");
      assertEquals(result.description, "World");
      assertEquals(result.draft, false);
    });
  });

  describe("mergeFrontmatter", () => {
    it("creates frontmatter if missing", () => {
      const result = { title: "Hello" } as any;
      mergeFrontmatter(result);
      assertEquals(result.frontmatter.title, "Hello");
    });

    it("does not overwrite existing frontmatter values", () => {
      const result = {
        title: "From export",
        frontmatter: { title: "From frontmatter" },
      } as any;
      mergeFrontmatter(result);
      assertEquals(result.frontmatter.title, "From frontmatter");
    });

    it("merges description into frontmatter", () => {
      const result = { description: "Desc" } as any;
      mergeFrontmatter(result);
      assertEquals(result.frontmatter.description, "Desc");
    });

    it("handles empty result", () => {
      const result = {} as any;
      mergeFrontmatter(result);
      assertEquals(result.frontmatter !== undefined, true);
    });
  });
});
