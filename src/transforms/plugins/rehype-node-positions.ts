import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export interface RehypeNodePositionsOptions {
  filePath?: string;
}

interface MdxJsxNode {
  type: string;
  name?: string;
  tagName?: string;
  attributes?: Array<{ type: string; name: string; value: unknown }>;
  properties?: Record<string, unknown>;
  position?: { start: { line: number; column: number }; end?: { line: number; column: number } };
}

export function rehypeNodePositions(
  options: RehypeNodePositionsOptions = {},
): (tree: Root) => void {
  return function transform(tree: Root): void {
    visit(tree, (visitedNode) => {
      if (visitedNode.type === "element") {
        const node = visitedNode as Element;
        if (!node.position) return;

        addPositionAttributes(node, node.properties ?? (node.properties = {}), options.filePath);
        return;
      }

      const node = visitedNode as MdxJsxNode;
      if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return;
      if (!node.position) return;

      const attributes = node.attributes ?? (node.attributes = []);
      const { start, end } = node.position;

      attributes.push(
        { type: "mdxJsxAttribute", name: "data-node-line", value: String(start.line) },
        { type: "mdxJsxAttribute", name: "data-node-column", value: String(start.column - 1) },
      );

      if (end) {
        attributes.push(
          { type: "mdxJsxAttribute", name: "data-node-end-line", value: String(end.line) },
          {
            type: "mdxJsxAttribute",
            name: "data-node-end-column",
            value: String(end.column - 1),
          },
        );
      }

      if (!options.filePath) return;

      attributes.push({
        type: "mdxJsxAttribute",
        name: "data-node-file",
        value: options.filePath,
      });
    });
  };
}

function addPositionAttributes(
  node: Element,
  properties: Record<string, unknown>,
  filePath?: string,
): void {
  const { position } = node;
  if (!position) return;

  const { start, end } = position;

  properties["data-node-line"] = start.line;
  properties["data-node-column"] = start.column - 1; // Convert to 0-based

  if (end) {
    properties["data-node-end-line"] = end.line;
    properties["data-node-end-column"] = end.column - 1; // Convert to 0-based
  }

  if (filePath) {
    properties["data-node-file"] = filePath;
  }
}
