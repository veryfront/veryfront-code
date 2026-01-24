/**
 * Tests for MDX module code generator
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { generateModuleCode } from "./code-generator.ts";
import type { MDXFrontmatter } from "./types.ts";

function runGenerateModuleCodeTest(
  frontmatter: MDXFrontmatter,
  mdxCode: string,
  assertions: (result: string) => void,
): void {
  const result = generateModuleCode(frontmatter, mdxCode);
  assertions(result);
}

describe("code-generator", () => {
  describe("generateModuleCode", () => {
    it("should generate module with frontmatter", () => {
      runGenerateModuleCodeTest(
        {
          title: "Test Title",
          description: "Test Description",
          layout: true,
        },
        "export default function MDXContent() { return <div>Hello</div>; }",
        (result) => {
          expect(result).toContain("export const frontmatter");
          expect(result).toContain('"title": "Test Title"');
          expect(result).toContain('"description": "Test Description"');
          expect(result).toContain('"layout": true');
        },
      );
    });

    it("should export individual frontmatter fields", () => {
      runGenerateModuleCodeTest(
        {
          title: "My Blog Post",
          description: "A great post",
          layout: false,
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('export const title = "My Blog Post"');
          expect(result).toContain('export const description = "A great post"');
          expect(result).toContain("export const layout = false");
        },
      );
    });

    it("should handle undefined title with empty string default", () => {
      runGenerateModuleCodeTest(
        { description: "Test" },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('export const title = ""');
        },
      );
    });

    it("should handle undefined description with empty string default", () => {
      runGenerateModuleCodeTest(
        { title: "Test" },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('export const description = ""');
        },
      );
    });

    it("should handle undefined layout with true as default", () => {
      runGenerateModuleCodeTest(
        { title: "Test" },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain("export const layout = true");
        },
      );
    });

    it("should include MDX code as-is", () => {
      const mdxCode = "export default function MDXContent() { return <h1>Hello World</h1>; }";
      runGenerateModuleCodeTest({ title: "Test" }, mdxCode, (result) => {
        expect(result).toContain(mdxCode);
      });
    });

    it("should handle empty frontmatter", () => {
      runGenerateModuleCodeTest({}, "export default function MDXContent() {}", (result) => {
        expect(result).toContain("export const frontmatter = {}");
        expect(result).toContain('export const title = ""');
        expect(result).toContain('export const description = ""');
        expect(result).toContain("export const layout = true");
      });
    });

    it("should handle empty MDX code", () => {
      runGenerateModuleCodeTest({ title: "Test" }, "", (result) => {
        expect(result).toContain("export const frontmatter");
        expect(result).toContain(""); // Empty string
      });
    });

    it("should format frontmatter with indentation", () => {
      runGenerateModuleCodeTest(
        {
          title: "Test",
          description: "Desc",
          custom: "value",
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('{\n  "title"');
          expect(result).toContain("\n}");
        },
      );
    });

    it("should preserve custom frontmatter fields", () => {
      runGenerateModuleCodeTest(
        {
          title: "Test",
          author: "John Doe",
          date: "2024-01-01",
          tags: ["react", "typescript"],
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('"author": "John Doe"');
          expect(result).toContain('"date": "2024-01-01"');
          expect(result).toContain('"tags"');
          expect(result).toContain('"react"');
          expect(result).toContain('"typescript"');
        },
      );
    });

    it("should handle special characters in frontmatter", () => {
      runGenerateModuleCodeTest(
        {
          title: 'Test "Quote"',
          description: "Test's apostrophe",
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain('Test \\"Quote\\"');
          expect(result).toContain("Test's apostrophe");
        },
      );
    });

    it("should handle multiline MDX code", () => {
      runGenerateModuleCodeTest(
        { title: "Test" },
        `
        export default function MDXContent() {
          return (
            <div>
              <h1>Hello</h1>
              <p>World</p>
            </div>
          );
        }
      `,
        (result) => {
          expect(result).toContain("<h1>Hello</h1>");
          expect(result).toContain("<p>World</p>");
        },
      );
    });

    it("should include auto-generated comment", () => {
      runGenerateModuleCodeTest(
        { title: "Test" },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain("// Auto-generated MDX module with frontmatter");
        },
      );
    });

    it("should handle layout set to false explicitly", () => {
      runGenerateModuleCodeTest(
        {
          title: "Test",
          layout: false,
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain("export const layout = false");
        },
      );
    });

    it("should handle layout set to true explicitly", () => {
      runGenerateModuleCodeTest(
        {
          title: "Test",
          layout: true,
        },
        "export default function MDXContent() {}",
        (result) => {
          expect(result).toContain("export const layout = true");
        },
      );
    });

    it("should generate valid JavaScript module", () => {
      runGenerateModuleCodeTest(
        {
          title: "Valid Module",
          description: "Testing valid JS",
        },
        "export default function MDXContent() { return null; }",
        (result) => {
          expect(result).toContain("export const frontmatter");
          expect(result).toContain("export const title");
          expect(result).toContain("export const description");
          expect(result).toContain("export const layout");
          expect(result).toContain("export default function MDXContent()");
        },
      );
    });
  });
});
