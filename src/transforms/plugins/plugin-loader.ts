import type { Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";
import type { Pluggable } from "npm:unified@11";
import { rehypeAddClasses, rehypeMdxComponents, rehypePreserveNodeIds } from "./rehype-utils.ts";
import { remarkMdxHeadings } from "./remark-headings.ts";
import {
  remarkCodeBlocks,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./remark-mdx-utils.ts";
import { rehypeMermaid } from "./rehype-mermaid.ts";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";

export type PluginFunction = (
  tree: MdastRoot | HastRoot,
  file?: unknown,
) => void | Promise<void> | ((tree: MdastRoot | HastRoot, file?: unknown) => void);

/**
 * Get remark plugins for MDX processing
 *
 * Note: remarkAddNodeId is disabled to fix hydration mismatch.
 * Browser modules no longer inject positions, so SSR must not inject them either.
 */
export function getRemarkPlugins(): Pluggable[] {
  return [
    remarkGfm,
    remarkFrontmatter,
    remarkMdxHeadings,
    remarkMdxRemoveParagraphs,
    remarkCodeBlocks,
    remarkMdxImports,
  ];
}

/**
 * Get rehype plugins for MDX processing
 */
export function getRehypePlugins(): Pluggable[] {
  return [
    rehypeMermaid, // Must run before rehypeHighlight
    rehypeHighlight,
    rehypeSlug,
    rehypePreserveNodeIds,
    rehypeAddClasses,
    rehypeMdxComponents,
  ];
}
