/**
 * Tests for MDX module code generator
 */

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateModuleCode } from "./code-generator.ts";
import type { MDXFrontmatter } from "./types.ts";

describe("code-generator", () => {
  describe("generateModuleCode", () => {
    it("should generate module with frontmatter", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test Title",
        description: "Test Description",
        layout: true,
      };
      const mdxCode = "export default function MDXContent() { return <div>Hello</div>; }";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const frontmatter");
      expect(result).toContain('"title": "Test Title"');
      expect(result).toContain('"description": "Test Description"');
      expect(result).toContain('"layout": true');
    });

    it("should export individual frontmatter fields", () => {
      const frontmatter: MDXFrontmatter = {
        title: "My Blog Post",
        description: "A great post",
        layout: false,
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain('export const title = "My Blog Post"');
      expect(result).toContain('export const description = "A great post"');
      expect(result).toContain("export const layout = false");
    });

    it("should handle undefined title with empty string default", () => {
      const frontmatter: MDXFrontmatter = {
        description: "Test",
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain('export const title = ""');
    });

    it("should handle undefined description with empty string default", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain('export const description = ""');
    });

    it("should handle undefined layout with true as default", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const layout = true");
    });

    it("should include MDX code as-is", () => {
      const frontmatter: MDXFrontmatter = { title: "Test" };
      const mdxCode = "export default function MDXContent() { return <h1>Hello World</h1>; }";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain(mdxCode);
    });

    it("should handle empty frontmatter", () => {
      const frontmatter: MDXFrontmatter = {};
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const frontmatter = {}");
      expect(result).toContain('export const title = ""');
      expect(result).toContain('export const description = ""');
      expect(result).toContain("export const layout = true");
    });

    it("should handle empty MDX code", () => {
      const frontmatter: MDXFrontmatter = { title: "Test" };
      const mdxCode = "";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const frontmatter");
      expect(result).toContain(mdxCode); // Empty string
    });

    it("should format frontmatter with indentation", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
        description: "Desc",
        custom: "value",
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      // Should have formatted JSON with 2 spaces
      expect(result).toContain('{\n  "title"');
      expect(result).toContain("\n}");
    });

    it("should preserve custom frontmatter fields", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
        author: "John Doe",
        date: "2024-01-01",
        tags: ["react", "typescript"],
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain('"author": "John Doe"');
      expect(result).toContain('"date": "2024-01-01"');
      expect(result).toContain('"tags"');
      expect(result).toContain('"react"');
      expect(result).toContain('"typescript"');
    });

    it("should handle special characters in frontmatter", () => {
      const frontmatter: MDXFrontmatter = {
        title: 'Test "Quote"',
        description: "Test's apostrophe",
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain('Test \\"Quote\\"');
      expect(result).toContain("Test's apostrophe");
    });

    it("should handle multiline MDX code", () => {
      const frontmatter: MDXFrontmatter = { title: "Test" };
      const mdxCode = `
        export default function MDXContent() {
          return (
            <div>
              <h1>Hello</h1>
              <p>World</p>
            </div>
          );
        }
      `;
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("<h1>Hello</h1>");
      expect(result).toContain("<p>World</p>");
    });

    it("should include auto-generated comment", () => {
      const frontmatter: MDXFrontmatter = { title: "Test" };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("// Auto-generated MDX module with frontmatter");
    });

    it("should handle layout set to false explicitly", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
        layout: false,
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const layout = false");
    });

    it("should handle layout set to true explicitly", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Test",
        layout: true,
      };
      const mdxCode = "export default function MDXContent() {}";
      const result = generateModuleCode(frontmatter, mdxCode);

      expect(result).toContain("export const layout = true");
    });

    it("should generate valid JavaScript module", () => {
      const frontmatter: MDXFrontmatter = {
        title: "Valid Module",
        description: "Testing valid JS",
      };
      const mdxCode = "export default function MDXContent() { return null; }";
      const result = generateModuleCode(frontmatter, mdxCode);

      // Should be valid JS - check for proper exports
      expect(result).toContain("export const frontmatter");
      expect(result).toContain("export const title");
      expect(result).toContain("export const description");
      expect(result).toContain("export const layout");
      expect(result).toContain("export default function MDXContent()");
    });
  });
});
