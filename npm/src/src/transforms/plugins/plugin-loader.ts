import type { Root as HastRoot } from "@types/hast";
import type { Root as MdastRoot } from "@types/mdast";
import type { Pluggable } from "unified";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { remarkMdxHeadings } from "./remark-headings.js";
import { remarkCodeBlocks, remarkMdxRemoveParagraphs } from "./remark-mdx-utils.js";

export type PluginFunction = (
  tree: MdastRoot | HastRoot,
  file?: unknown,
) => void | Promise<void> | ((tree: MdastRoot | HastRoot, file?: unknown) => void);

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
  return [
    rehypeHighlight,
    rehypeSlug,
  ];
}
