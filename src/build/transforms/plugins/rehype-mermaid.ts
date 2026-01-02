import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/**
 * Rehype plugin to transform mermaid code blocks for client-side rendering.
 *
 * Transforms:
 * ```mermaid
 * graph TD
 *   A --> B
 * ```
 *
 * Into:
 * <div class="mermaid">
 * graph TD
 *   A --> B
 * </div>
 *
 * The Mermaid library (loaded client-side) will then render these as diagrams.
 */
export function rehypeMermaid() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      // Look for <pre><code class="language-mermaid">
      if (
        node.tagName === "pre" &&
        node.children.length === 1 &&
        node.children[0].type === "element" &&
        node.children[0].tagName === "code"
      ) {
        const codeNode = node.children[0] as Element;
        const className = codeNode.properties?.className;

        // Check if it's a mermaid code block
        const isMermaid = Array.isArray(className)
          ? className.some((c) => String(c).includes("mermaid") || String(c).includes("language-mermaid"))
          : String(className || "").includes("mermaid");

        if (isMermaid && parent && typeof index === "number") {
          // Extract the text content
          const textContent = extractText(codeNode);

          // Replace the pre/code with a mermaid div
          const mermaidDiv: Element = {
            type: "element",
            tagName: "div",
            properties: {
              className: ["mermaid"],
            },
            children: [{ type: "text", value: textContent }],
          };

          // Replace the node
          (parent.children as Element[])[index] = mermaidDiv;
        }
      }
    });
  };
}

function extractText(node: Element): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "element") {
      text += extractText(child);
    }
  }
  return text.trim();
}
