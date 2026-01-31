import type { MDXFrontmatter } from "./types.ts";

export function generateModuleCode(frontmatter: MDXFrontmatter, mdxCode: string): string {
  const { title = "", description = "", layout = true } = frontmatter;

  return `
// Auto-generated MDX module with frontmatter
export const frontmatter = ${JSON.stringify(frontmatter, null, 2)};
export const title = ${JSON.stringify(title)};
export const description = ${JSON.stringify(description)};
export const layout = ${JSON.stringify(layout)};

// Include the compiled MDX code as-is
${mdxCode}
`;
}
