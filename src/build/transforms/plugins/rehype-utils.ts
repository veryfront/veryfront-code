import type { Element } from "hast";
import { visit } from "unist-util-visit";

export function rehypePreserveNodeIds() {
  return (tree: { type: string; children?: unknown[] }) => {
    visit(tree, "element", (node: Element) => {
      if (!node.properties) {
        node.properties = {};
      }

      if (node.data && (node.data as Record<string, unknown>).hProperties) {
        for (
          const [key, value] of Object.entries(
            (node.data as Record<string, unknown>).hProperties as Record<string, unknown>,
          )
        ) {
          if (key.startsWith("data-node-")) {
            node.properties![key] = value as string;
          }
        }
      }
    });
  };
}

export function rehypeAddClasses() {
  return (tree: { type: string; children?: unknown[] }) => {
    visit(tree, "element", (node: Element) => {
      if (!node.properties) {
        node.properties = {};
      }

      switch (node.tagName) {
        case "p":
          addClassName(node, "mb-4");
          break;
        case "h1":
          addClassName(node, "text-4xl font-bold mb-8 mt-12");
          break;
        case "h2":
          addClassName(node, "text-3xl font-bold mb-6 mt-10");
          break;
        case "h3":
          addClassName(node, "text-2xl font-bold mb-4 mt-8");
          break;
        case "a":
          addClassName(node, "text-blue-600 hover:text-blue-800 underline");
          break;
        case "code":
          if (
            Array.isArray(node.properties.className) &&
            node.properties.className.some((cls) => String(cls).includes("language-"))
          ) {
            addClassName(node, "block p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto");
          } else {
            addClassName(node, "px-1 py-0.5 bg-gray-100 text-gray-900 rounded text-sm");
          }
          break;
        case "blockquote":
          addClassName(node, "border-l-4 border-gray-300 pl-4 italic");
          break;
        case "ul":
          addClassName(node, "list-disc list-inside mb-4");
          break;
        case "ol":
          addClassName(node, "list-decimal list-inside mb-4");
          break;
        case "li":
          addClassName(node, "mb-2");
          break;
      }
    });
  };
}

export function rehypeMdxComponents() {
  return (tree: { type: string; children?: unknown[] }) => {
    visit(tree, "mdxJsxFlowElement", (node: { name: string; data?: Record<string, unknown> }) => {
      if (!node.data) {
        node.data = {};
      }
      if (!(node.data as Record<string, unknown>).hProperties) {
        (node.data as Record<string, unknown>).hProperties = {};
      }

      ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
        "data-mdx-component"
      ] = node.name;
    });
  };
}

function addClassName(node: Element, className: string) {
  if (!node.properties) {
    node.properties = {};
  }

  if (!node.properties.className) {
    node.properties.className = [];
  } else if (typeof node.properties.className === "string") {
    node.properties.className = node.properties.className.split(" ");
  }

  (node.properties.className as string[]).push(className);
}
