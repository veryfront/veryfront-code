import type { MDXFrontmatter } from "./types.ts";
import { createFrontmatterModuleExpression, normalizeMDXFrontmatter } from "../frontmatter.ts";

export function generateModuleCode(frontmatter: MDXFrontmatter, mdxCode: string): string {
  if (typeof mdxCode !== "string") throw new TypeError("MDX code must be a string");
  const normalizedFrontmatter = normalizeMDXFrontmatter(frontmatter);
  const { title = "", description = "", layout = true } = normalizedFrontmatter;

  return `
// Auto-generated MDX module with frontmatter
export const frontmatter = ${createFrontmatterModuleExpression(normalizedFrontmatter)};
export const title = ${JSON.stringify(title)};
export const description = ${JSON.stringify(description)};
export const layout = ${JSON.stringify(layout)};

// Include the compiled MDX code as-is
${mdxCode}
`;
}
