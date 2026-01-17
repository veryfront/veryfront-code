/**
 * Rehype plugin to inject node position data attributes
 *
 * This adds data-node-line, data-node-column, data-node-end-line, data-node-end-column
 * attributes to JSX/HTML elements during MDX compilation.
 * These attributes are used by Studio Navigator to map DOM nodes back to source positions.
 */

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export interface RehypeNodePositionsOptions {
  filePath?: string;
}

// Node types that can have attributes
interface MdxJsxNode {
  type: string;
  name?: string;
  tagName?: string;
  attributes?: Array<{ type: string; name: string; value: unknown }>;
  properties?: Record<string, unknown>;
  position?: { start: { line: number; column: number }; end?: { line: number; column: number } };
}

// Union type for all possible nodes in the tree
type TreeNode = Element | MdxJsxNode;

export function rehypeNodePositions(options: RehypeNodePositionsOptions = {}) {
  console.log("[rehypeNodePositions] Plugin called with options:", options);

  return (tree: Root) => {
    console.log(
      "[rehypeNodePositions] Processing tree, root type:",
      tree.type,
      "children:",
      tree.children?.length,
    );

    // Log first few child types to understand structure
    const children = tree.children?.slice(0, 5) ?? [];
    for (const [i, child] of children.entries()) {
      const childNode = child as MdxJsxNode;
      console.log(
        `[rehypeNodePositions] Child ${i}: type=${childNode.type}, name=${
          childNode.name || childNode.tagName || "N/A"
        }`,
      );
    }

    let elementCount = 0;
    let positionCount = 0;

    // Visit all node types and filter for JSX elements
    visit(tree, (visitedNode) => {
      // Handle standard hast elements
      if (visitedNode.type === "element") {
        const node = visitedNode as Element;
        elementCount++;
        if (node.position) {
          positionCount++;
          addPositionAttributes(node, node.properties || (node.properties = {}), options.filePath);
        }
        return;
      }

      const node = visitedNode as MdxJsxNode;

      // Handle MDX JSX elements
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        elementCount++;
        console.log(
          "[rehypeNodePositions] Found MDX JSX element:",
          node.name,
          "position:",
          node.position ? "yes" : "no",
        );

        if (node.position) {
          positionCount++;

          // MDX JSX elements use attributes array instead of properties
          if (!node.attributes) {
            node.attributes = [];
          }

          const { start, end } = node.position;

          // Add position as JSX attributes
          if (start) {
            node.attributes.push(
              { type: "mdxJsxAttribute", name: "data-node-line", value: String(start.line) },
              {
                type: "mdxJsxAttribute",
                name: "data-node-column",
                value: String(start.column - 1),
              },
            );
          }
          if (end) {
            node.attributes.push(
              { type: "mdxJsxAttribute", name: "data-node-end-line", value: String(end.line) },
              {
                type: "mdxJsxAttribute",
                name: "data-node-end-column",
                value: String(end.column - 1),
              },
            );
          }
          if (options.filePath) {
            node.attributes.push(
              { type: "mdxJsxAttribute", name: "data-node-file", value: options.filePath },
            );
          }
        }
      }
    });

    console.log("[rehypeNodePositions] Processed", { elementCount, positionCount });
  };
}

function addPositionAttributes(
  node: Element,
  properties: Record<string, unknown>,
  filePath?: string,
): void {
  if (!node.position) return;

  const { start, end } = node.position;

  if (start) {
    properties["data-node-line"] = start.line;
    properties["data-node-column"] = start.column - 1; // Convert to 0-based
  }

  if (end) {
    properties["data-node-end-line"] = end.line;
    properties["data-node-end-column"] = end.column - 1; // Convert to 0-based
  }

  if (filePath) {
    properties["data-node-file"] = filePath;
  }
}

export default rehypeNodePositions;
