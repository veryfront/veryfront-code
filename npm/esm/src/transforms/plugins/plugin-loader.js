import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { remarkMdxHeadings } from "./remark-headings.js";
import { remarkCodeBlocks, remarkMdxRemoveParagraphs } from "./remark-mdx-utils.js";
export function getRemarkPlugins() {
    return [
        remarkGfm,
        remarkFrontmatter,
        remarkMdxHeadings,
        remarkMdxRemoveParagraphs,
        remarkCodeBlocks,
    ];
}
export function getRehypePlugins() {
    return [
        rehypeHighlight,
        rehypeSlug,
    ];
}
