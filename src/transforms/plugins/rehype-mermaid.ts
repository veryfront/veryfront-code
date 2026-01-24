import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export function rehypeMermaid(): (tree: Root) => void {
  return (tree: Root): void => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || node.children.length !== 1) return;

      const firstChild = node.children[0];
      if (
        !firstChild ||
        firstChild.type !== "element" ||
        firstChild.tagName !== "code"
      ) {
        return;
      }

      const codeNode = firstChild;
      const className = codeNode.properties?.className;

      let isMermaid = false;
      if (Array.isArray(className)) {
        isMermaid = className.some((c) => {
          const s = String(c);
          return s.includes("mermaid") || s.includes("language-mermaid");
        });
      } else {
        isMermaid = String(className ?? "").includes("mermaid");
      }

      if (!isMermaid || !parent || typeof index !== "number") return;

      const textContent = extractText(codeNode);

      const mermaidDiv: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value: textContent }],
      };

      (parent.children as Element[])[index] = mermaidDiv;
    });
  };
}

function extractText(node: Element): string {
  let text = "";

  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
      continue;
    }

    if (child.type === "element") {
      text += extractText(child);
    }
  }

  return text.trim();
}
