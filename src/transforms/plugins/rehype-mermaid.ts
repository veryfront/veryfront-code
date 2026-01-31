import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

export function rehypeMermaid(): (tree: Root) => void {
  return function transform(tree: Root): void {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "pre" || node.children.length !== 1) return;

      const codeNode = node.children[0];
      if (!codeNode || codeNode.type !== "element" || codeNode.tagName !== "code") return;

      if (!parent || typeof index !== "number") return;

      const className = codeNode.properties?.className;
      const isMermaid = Array.isArray(className)
        ? className.some((c) => {
          const s = String(c);
          return s.includes("mermaid") || s.includes("language-mermaid");
        })
        : String(className ?? "").includes("mermaid");

      if (!isMermaid) return;

      const mermaidDiv: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value: extractText(codeNode) }],
      };

      parent.children[index] = mermaidDiv;
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
