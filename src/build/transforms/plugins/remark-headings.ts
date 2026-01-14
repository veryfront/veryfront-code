import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import type { VFile } from "npm:vfile@6";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

interface HeadingEntry {
  text: string;
  id: string;
  level: number;
}

// Extended heading data to support hProperties (used by mdast-util-to-hast)
interface HeadingWithHProperties extends Heading {
  data?: Heading["data"] & {
    hProperties?: Record<string, unknown>;
  };
}

export function remarkMdxHeadings() {
  const slugger = new GithubSlugger();

  return (tree: Root, file: VFile) => {
    const headings: HeadingEntry[] = [];

    slugger.reset();

    visit(tree, "heading", (node: HeadingWithHProperties) => {
      const text = toString(node);
      const id = slugger.slug(text);

      node.data ??= {};
      node.data.hProperties ??= {};
      node.data.hProperties.id = id;

      headings.push({
        text,
        id,
        level: node.depth,
      });
    });

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

    // Insert the headings export at the beginning of the tree
    // The headingsExport structure is compatible with mdast-util-mdx-jsx's MdxjsEsm type
    tree.children.unshift(headingsExport as typeof tree.children[number]);
  };
}
