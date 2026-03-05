/**
 * Rehype plugin that injects source location attributes on every element.
 *
 * Handles both:
 *   - HTML elements from markdown (h1, p, li, …)
 *   - MDX JSX nodes (mdxJsxFlowElement, mdxJsxTextElement)
 *
 * Injected attributes:
 *   data-node-file   — project-relative source file path
 *   data-node-name   — element or component name
 *   data-node-line   — source line number
 *   data-node-column — source column number (0-based)
 */

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export interface RehypeNodePositionsOptions {
  filePath?: string;
}

interface MdxJsxNode {
  type: string;
  name?: string;
  attributes?: Array<{ type: string; name: string; value: unknown }>;
  position?: { start: { line: number; column: number } };
}

export function rehypeNodePositions(
  options: RehypeNodePositionsOptions = {},
): (tree: Root) => void {
  return function transform(tree: Root): void {
    visit(tree, (node) => {
      if (node.type === "element") {
        const el = node as Element;
        if (!el.position) return;

        const props = el.properties ?? (el.properties = {});
        const { start } = el.position;

        if (options.filePath) props["data-node-file"] = options.filePath;
        props["data-node-name"] = el.tagName;
        props["data-node-line"] = String(start.line);
        props["data-node-column"] = String(start.column - 1);
        props["data-node-source"] = "md";
        return;
      }

      if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return;

      const mdx = node as MdxJsxNode;
      if (!mdx.position) return;

      const attrs = mdx.attributes ?? (mdx.attributes = []);
      const { start } = mdx.position;

      if (options.filePath) {
        attrs.push({ type: "mdxJsxAttribute", name: "data-node-file", value: options.filePath });
      }
      attrs.push(
        { type: "mdxJsxAttribute", name: "data-node-name", value: mdx.name || "unknown" },
        { type: "mdxJsxAttribute", name: "data-node-line", value: String(start.line) },
        { type: "mdxJsxAttribute", name: "data-node-column", value: String(start.column - 1) },
      );
    });
  };
}
