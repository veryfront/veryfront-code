import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

interface FileData {
  headings?: Array<{ text: string; id: string; level: number }>;
}

interface VFile {
  data?: FileData;
}

export function remarkMdxHeadings() {
  const slugger = new GithubSlugger();

  return (tree: Root, file: VFile) => {
    const headings: Array<{
      text: string;
      id: string;
      level: number;
    }> = [];

    slugger.reset();

    visit(tree, "heading", (node: Heading) => {
      const text = toString(node);
      const id = slugger.slug(text);

      if (!node.data) {
        node.data = {};
      }
      if (!(node.data as Record<string, unknown>).hProperties) {
        (node.data as Record<string, unknown>).hProperties = {};
      }
      ((node.data as Record<string, unknown>).hProperties as Record<string, unknown>).id = id;

      headings.push({
        text,
        id,
        level: node.depth,
      });
    });

    if (!file.data) {
      file.data = {};
    }
    file.data.headings = headings;

    const headingsExport = {
      type: "mdxjsEsm",
      value: "",
      data: {
        estree: {
          type: "Program",
          sourceType: "module",
          body: [
            {
              type: "ExportNamedDeclaration",
              specifiers: [],
              source: null,
              declaration: {
                type: "VariableDeclaration",
                kind: "const",
                declarations: [
                  {
                    type: "VariableDeclarator",
                    id: { type: "Identifier", name: "headings" },
                    init: {
                      type: "ArrayExpression",
                      elements: headings.map((h) => ({
                        type: "ObjectExpression",
                        properties: [
                          {
                            type: "Property",
                            key: { type: "Identifier", name: "text" },
                            value: { type: "Literal", value: h.text },
                            kind: "init",
                            method: false,
                            shorthand: false,
                            computed: false,
                          },
                          {
                            type: "Property",
                            key: { type: "Identifier", name: "id" },
                            value: { type: "Literal", value: h.id },
                            kind: "init",
                            method: false,
                            shorthand: false,
                            computed: false,
                          },
                          {
                            type: "Property",
                            key: { type: "Identifier", name: "level" },
                            value: { type: "Literal", value: h.level },
                            kind: "init",
                            method: false,
                            shorthand: false,
                            computed: false,
                          },
                        ],
                      })),
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    };

    tree.children.unshift(headingsExport as unknown as (typeof tree.children)[0]);
  };
}
