import type { Pluggable } from "unified";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { remarkMdxHeadings } from "./remark-headings.ts";
import { remarkCodeBlocks, remarkMdxRemoveParagraphs } from "./remark-mdx-utils.ts";

export function getRemarkPlugins(): Pluggable[] {
  return [
    remarkGfm,
    remarkFrontmatter,
    remarkMdxHeadings,
    remarkMdxRemoveParagraphs,
    remarkCodeBlocks,
  ];
}

export function getRehypePlugins(): Pluggable[] {
  return [rehypeHighlight, rehypeSlug];
}
