import type { Code, Paragraph, Root } from "mdast";
import type { Data, Node, Parent } from "unist";
import type { VFile } from "npm:vfile@6";
import { CONTINUE, SKIP, visit } from "unist-util-visit";

interface MDXJsxElement extends Node {
  type: "mdxJsxTextElement" | "mdxJsxFlowElement";
  children?: Node[];
}

/**
 * Spacer node to preserve whitespace when unwrapping paragraphs
 */
const spacer = {
  type: "mdxFlowExpression",
  value: "' '",
  data: {
    estree: {
      type: "Program",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "Literal",
            value: " ",
            raw: "' '",
          },
        },
      ],
      sourceType: "module",
    },
  },
};

const splice = [].splice;

interface MergeChildrenOptions {
  node: Record<string, Node[]>;
  index: number;
  children: Node[];
}

function mergeChildren({ node, index, children }: MergeChildrenOptions) {
  if (!node?.children) {
    return;
  }
  // From: https://github.com/mdx-js/mdx/issues/1451#issuecomment-780428572
  splice.apply(node.children, [index, 1, ...children] as unknown as [number, number]);
}

const textNodeTypes = new Set([
  "text",
  "paragraph",
  "heading",
  "link",
  "image",
  "list",
  "listItem",
  "emphasis",
  "strong",
  "blockquote",
  "code",
  "inlineCode",
  "thematicBreak",
  "table",
  "tableRow",
  "tableCell",
  "footnote",
  "footnoteDefinition",
]);

const validParentBlockElements = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "details",
  "dialog",
  "canvas",
  "dl",
  "dt",
  "dd",
  "div",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hgroup",
  "main",
  "nav",
  "pre",
  "section",
  "video",
]);

function isJsxComponentName(name = "") {
  // Check if name starts with a capital letter (JSX component, not HTML element)
  return name?.match(/^[A-Z]/);
}

interface ExtendedParent extends Parent {
  name?: string;
  tagName?: string;
  children: (Node & { isMdxTextSpacer?: boolean })[];
}

/**
 * Removes unnecessary <p> elements from MDX content.
 *
 * Handles edge cases where <p> elements get incorrectly nested inside JSX components:
 * - `<Button><p>text</p></Button>` → `<Button>text</Button>`
 * - Inline parents: `<span><p>text</p></span>` → `<span>text</span>`
 * - Multiple children with mixed content
 */
export function remarkMdxRemoveParagraphs() {
  return (tree: Root) => {
    // First pass: add spacers between elements when parent has non-text children
    visit(tree, ["paragraph"], (_node, _index, parent) => {
      const extParent = parent as ExtendedParent | undefined;
      const parentName = extParent?.name || extParent?.type || extParent?.tagName;

      // Leave root elements alone
      if (parentName === "root") {
        return CONTINUE;
      }

      // When <p> element contains child other than text
      const hasNonTextChild = extParent?.children?.some(
        (child) => !textNodeTypes.has(child?.type),
      );

      // Add spaces between all elements in preparation for the replacement
      if (hasNonTextChild && extParent) {
        const children: (Node & { isMdxTextSpacer?: boolean })[] = [];

        extParent.children.forEach((child, i) => {
          const isAlreadySpaced = extParent.children.some((c) => !!c.isMdxTextSpacer);

          if (i > 0 && !isAlreadySpaced) {
            children.push(
              {
                ...spacer,
                isMdxTextSpacer: true,
              } as Node & { isMdxTextSpacer: boolean },
            );
          }
          children.push(child);
        });

        extParent.children = children;
      }

      return CONTINUE;
    });

    // Second pass: unwrap paragraphs
    visit(tree, ["paragraph"], (node, index, parent) => {
      const extParent = parent as ExtendedParent | undefined;
      const paragraphNode = node as Paragraph;
      const previousChild = extParent?.children?.[typeof index === "number" ? index - 1 : -1];
      const parentName = extParent?.name || extParent?.type || extParent?.tagName;

      // Unwrap <p> elements when they appear inside a direct <p> parent
      if (parentName === "p" && extParent && typeof index === "number") {
        const child = paragraphNode.children?.at(0);
        if (child) {
          extParent.children[index] = child as Node & { isMdxTextSpacer?: boolean };
        }
        return [SKIP, index];
      }

      // Keep behavior consistent between children
      if (previousChild?.type === "paragraph") {
        return CONTINUE;
      }

      // Leave root elements alone
      if (parentName === "root") {
        return CONTINUE;
      }

      // When <p> element contains child other than text
      const hasNonTextChild = extParent?.children?.some(
        (child) => !textNodeTypes.has(child?.type),
      );

      if (hasNonTextChild && typeof index === "number") {
        // Unwrap <p> elements when child contains other children besides text
        mergeChildren({
          node: extParent as unknown as Record<string, Node[]>,
          index,
          children: paragraphNode.children as Node[],
        });

        return [SKIP, index];
      }

      // Unwrap <p> elements with single text child elements
      // e.g. <Button><p>Do not wrap</p></Button> => <Button>Do not wrap</Button>
      if (extParent?.children.length === 1) {
        extParent.children = paragraphNode.children as (Node & { isMdxTextSpacer?: boolean })[];
        return [SKIP, typeof index === "number" ? index : 0];
      }

      const isElementParent = !isJsxComponentName(parentName);
      const isInlineParent = !validParentBlockElements.has(parentName || "");

      // Unwrap <p> elements which are children of inline elements
      // e.g. <span><p>Do not wrap</p></span> => <span>Do not wrap</span>
      if (isElementParent && isInlineParent && extParent && typeof index === "number") {
        const child = paragraphNode.children?.at(0);
        if (child) {
          extParent.children[index] = child as Node & { isMdxTextSpacer?: boolean };
        }
        return CONTINUE;
      }

      return CONTINUE;
    });
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

    visit(tree, "mdxjsEsm", (node: MDXjsEsm) => {
      if (node.value?.includes("import")) {
        const importMatches = node.value.matchAll(
          /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g,
        );

        for (const match of importMatches) {
          const path = match[1];
          if (typeof path === "string") imports.push(path);
        }
      }
    });

    file.data.imports = imports;
  };
}
