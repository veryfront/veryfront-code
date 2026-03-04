import { visit } from "unist-util-visit";

type Tree = { type: string; children?: unknown[] };

export function rehypeMdxComponents() {
  return (tree: Tree): void => {
    visit(tree, "mdxJsxFlowElement", (node: { name: string; data?: Record<string, unknown> }) => {
      node.data ??= {};
      const data = node.data;

      const hProperties = (data.hProperties as Record<string, unknown> | undefined) ?? {};
      data.hProperties = hProperties;
      hProperties["data-mdx-component"] = node.name;
    });
  };
}
