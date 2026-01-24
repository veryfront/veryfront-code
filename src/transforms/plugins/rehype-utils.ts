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

export function rehypeAddClasses() {
  return (tree: Tree): void => {
    visit(tree, "element", (node: Element) => {
      node.properties ??= {};

      switch (node.tagName) {
        case "p":
          addClassName(node, "mb-4");
          return;
        case "h1":
          addClassName(node, "text-4xl font-bold mb-8 mt-12");
          return;
        case "h2":
          addClassName(node, "text-3xl font-bold mb-6 mt-10");
          return;
        case "h3":
          addClassName(node, "text-2xl font-bold mb-4 mt-8");
          return;
        case "a":
          addClassName(node, "text-blue-600 hover:text-blue-800 underline");
          return;
        case "code": {
          const className = node.properties.className;
          const isFencedCode = Array.isArray(className) &&
            className.some((cls) => String(cls).includes("language-"));

          if (isFencedCode) {
            addClassName(node, "block p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto");
          } else {
            addClassName(node, "px-1 py-0.5 bg-gray-100 text-gray-900 rounded text-sm");
          }
          return;
        }
        case "blockquote":
          addClassName(node, "border-l-4 border-gray-300 pl-4 italic");
          return;
        case "ul":
          addClassName(node, "list-disc list-inside mb-4");
          return;
        case "ol":
          addClassName(node, "list-decimal list-inside mb-4");
          return;
        case "li":
          addClassName(node, "mb-2");
          return;
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

function addClassName(node: Element, className: string): void {
  node.properties ??= {};

  const props = node.properties;
  const existing = props.className;

  if (!existing) {
    props.className = [];
  } else if (typeof existing === "string") {
    props.className = existing.split(" ");
  }

  (props.className as string[]).push(className);
}
