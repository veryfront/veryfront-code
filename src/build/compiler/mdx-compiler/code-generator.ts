import type { MDXFrontmatter } from "./types.ts";

export function generateModuleCode(frontmatter: MDXFrontmatter, mdxCode: string): string {
  const title = frontmatter.title !== undefined ? frontmatter.title : "";
  const description = frontmatter.description !== undefined ? frontmatter.description : "";
  const layout = frontmatter.layout !== undefined ? frontmatter.layout : true;

  return `
export const frontmatter = ${JSON.stringify(frontmatter, null, 2)};
export const title = ${JSON.stringify(title)};
export const description = ${JSON.stringify(description)};
export const layout = ${JSON.stringify(layout)};

${mdxCode}
`;
}
