import type { Code, Paragraph, Root } from "mdast";
import type { Data, Node, Parent } from "unist";
import { visit } from "unist-util-visit";

interface FileData {
  imports?: string[];
}

interface VFile {
  data?: FileData;
}

interface MDXJsxElement extends Node {
  type: "mdxJsxTextElement" | "mdxJsxFlowElement";
  children?: Node[];
}

export function remarkMdxRemoveParagraphs() {
  return (tree: Root) => {
    visit(
      tree as unknown as Root,
      "paragraph",
      (node: Node, index: number | null | undefined, parent: Parent | undefined) => {
        const children = Array.isArray((node as Paragraph)?.children)
          ? (node as Paragraph).children as Node[]
          : [];
        if (
          children.length === 1 &&
          ((children[0] as Node)?.type === "mdxJsxTextElement" ||
            (children[0] as Node)?.type === "mdxJsxFlowElement")
        ) {
          if (parent && Array.isArray(parent.children) && typeof index === "number") {
            parent.children.splice(index, 1, children[0] as Node);
          }
        }
      },
    );
  };
}

export function remarkCodeBlocks() {
  return (tree: Root) => {
    visit(tree, "code", (node: Code) => {
      if (!node.data) {
        node.data = {};
      }
      if (!(node.data as Record<string, unknown>).hProperties) {
        (node.data as Record<string, unknown>).hProperties = {};
      }

      if (node.lang) {
        ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>).className =
          [`language-${node.lang}`];
      }

      if (node.meta) {
        const highlightMatch = node.meta.match(/\{([\d,-]+)\}/);
        if (highlightMatch) {
          ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>)[
            "data-line-numbers"
          ] = highlightMatch[1];
        }
      }
    });
  };
}

interface MDXjsEsm extends Node {
  type: "mdxjsEsm";
  value?: string;
  data?: Data;
}

export function remarkMdxImports() {
  return (tree: Root, file: VFile) => {
    const imports: string[] = [];

    visit(tree as unknown as Root, "mdxjsEsm", (node: MDXjsEsm) => {
      if (node.value?.includes("import")) {
        const importMatches = node.value.matchAll(
          /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g,
        );

        for (const match of importMatches) {
          const path = match[1] as string | undefined;
          if (typeof path === "string") imports.push(path);
        }
      }
    });

    if (!file.data) {
      file.data = {};
    }
    file.data.imports = imports;
  };
}
