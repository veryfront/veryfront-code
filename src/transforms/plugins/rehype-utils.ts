import type { Element } from "hast";
import { visit } from "unist-util-visit";

type Tree = { type: string; children?: unknown[] };

export function rehypePreserveNodeIds() {
  return (tree: Tree): void => {
    visit(tree, "element", (node: Element) => {
      node.properties ??= {};

      const hProperties = (node.data as Record<string, unknown> | undefined)?.hProperties as
        | Record<string, unknown>
        | undefined;

      if (!hProperties) return;

      for (const [key, value] of Object.entries(hProperties)) {
        if (key.startsWith("data-node-")) {
          node.properties[key] = value as string;
        }
      }
    });
  };
}

export function rehypeMdxComponents() {
  return (tree: Tree): void => {
    visit(tree, "mdxJsxFlowElement", (node: { name: string; data?: Record<string, unknown> }) => {
      node.data ??= {};
      const data = node.data as Record<string, unknown>;
      (data.hProperties as Record<string, unknown> | undefined) ??= {};
      (data.hProperties as Record<string, unknown>)["data-mdx-component"] = node.name;
    });
  };
}
