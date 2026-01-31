import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Code, Paragraph, Root } from "mdast";
import { VFile } from "vfile";
import {
  remarkCodeBlocks,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./remark-mdx-utils.ts";

function createCode(lang: string, value: string, meta?: string): Code {
  return { type: "code", lang, value, meta };
}

function createParagraph(...children: Paragraph["children"]): Paragraph {
  return { type: "paragraph", children };
}

function createTree(...nodes: Root["children"]): Root {
  return { type: "root", children: nodes };
}

function createEmptyTree(): Root {
  return createTree();
}

describe("remark-mdx-utils", () => {
  describe("remarkMdxRemoveParagraphs", () => {
    it("preserves root-level paragraphs with JSX text element", () => {
      const jsxElement = {
        type: "mdxJsxTextElement",
        name: "Component",
        children: [],
      };
      const tree = createTree(createParagraph(jsxElement));

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("preserves root-level paragraphs with JSX flow element", () => {
      const jsxElement = {
        type: "mdxJsxFlowElement",
        name: "Component",
        children: [],
      };
      const tree = createTree(createParagraph(jsxElement));

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("unwraps paragraphs inside JSX elements", () => {
      const textNode = { type: "text", value: "Click me" };
      const jsxParent = {
        type: "mdxJsxFlowElement",
        name: "Button",
        children: [createParagraph(textNode)],
      };
      const tree = createTree(jsxParent);

      remarkMdxRemoveParagraphs()(tree);

      const button = tree.children[0] as any;
      assertEquals(button.type, "mdxJsxFlowElement");
      assertEquals(button.children.length, 1);
      assertEquals(button.children[0].type, "text");
      assertEquals(button.children[0].value, "Click me");
    });

    it("keeps paragraph with multiple children", () => {
      const tree = createTree(
        createParagraph(
          { type: "text", value: "Hello " },
          { type: "mdxJsxTextElement", name: "Component" },
        ),
      );

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("keeps paragraph with text only", () => {
      const tree = createTree(
        createParagraph({ type: "text", value: "Hello World" }),
      );

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("handles empty tree", () => {
      const tree = createEmptyTree();

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 0);
    });

    it("preserves multiple root-level paragraphs", () => {
      const tree = createTree(
        createParagraph({ type: "mdxJsxFlowElement", name: "Comp1" }),
        createParagraph({ type: "mdxJsxFlowElement", name: "Comp2" }),
      );

      remarkMdxRemoveParagraphs()(tree);

      assertEquals(tree.children.length, 2);
      assertEquals((tree.children[0] as any).type, "paragraph");
      assertEquals((tree.children[1] as any).type, "paragraph");
    });
  });

  describe("remarkCodeBlocks", () => {
    it("adds language class", () => {
      const tree = createTree(createCode("javascript", "const x = 1"));

      remarkCodeBlocks()(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertExists(props?.className);
      assertEquals(props.className.includes("language-javascript"), true);
    });

    it("handles code without language", () => {
      const tree = createTree(createCode("", "const x = 1"));

      remarkCodeBlocks()(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.className, undefined);
    });

    it("extracts line numbers from meta", () => {
      const tree = createTree(
        createCode("typescript", "const x = 1", "{1-3,5}"),
      );

      remarkCodeBlocks()(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], "1-3,5");
    });

    it("handles meta without line numbers", () => {
      const tree = createTree(
        createCode("typescript", "const x = 1", "some meta"),
      );

      remarkCodeBlocks()(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], undefined);
    });

    it("handles code without meta", () => {
      const tree = createTree(createCode("typescript", "const x = 1"));

      remarkCodeBlocks()(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], undefined);
    });

    it("preserves existing data", () => {
      const code = createCode("typescript", "const x = 1");
      (code as any).data = { customProp: "value" };
      const tree = createTree(code);

      remarkCodeBlocks()(tree);

      assertEquals((tree.children[0] as any).data.customProp, "value");
    });

    it("preserves existing hProperties", () => {
      const code = createCode("typescript", "const x = 1");
      code.data = { hProperties: { id: "custom-id" } };
      const tree = createTree(code);

      remarkCodeBlocks()(tree);

      assertEquals((tree.children[0] as any).data.hProperties.id, "custom-id");
      assertExists((tree.children[0] as any).data.hProperties.className);
    });

    it("handles multiple code blocks", () => {
      const tree = createTree(
        createCode("javascript", "const x = 1"),
        createCode("typescript", "const y = 2", "{1}"),
      );

      remarkCodeBlocks()(tree);

      const props1 = (tree.children[0] as any).data?.hProperties;
      const props2 = (tree.children[1] as any).data?.hProperties;

      assertEquals(props1.className.includes("language-javascript"), true);
      assertEquals(props2.className.includes("language-typescript"), true);
      assertEquals(props2["data-line-numbers"], "1");
    });
  });

  describe("remarkMdxImports", () => {
    it("extracts import paths", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: 'import Button from "./components/Button"',
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertExists((file.data as any).imports);
      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components/Button");
    });

    it("handles multiple imports", () => {
      const tree = createTree(
        { type: "mdxjsEsm", value: 'import Button from "./Button"' },
        { type: "mdxjsEsm", value: 'import Card from "./Card"' },
      );
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 2);
      assertEquals((file.data as any).imports[0], "./Button");
      assertEquals((file.data as any).imports[1], "./Card");
    });

    it("handles named imports", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: 'import { Button, Card } from "./components"',
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });

    it("handles namespace imports", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: 'import * as Components from "./components"',
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });

    it("handles side-effect imports", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: 'import "./styles.css"',
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./styles.css");
    });

    it("handles single quotes", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: "import Button from './Button'",
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports[0], "./Button");
    });

    it("handles non-import mdxjsEsm nodes", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: "export const x = 1",
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 0);
    });

    it("handles empty tree", () => {
      const tree = createEmptyTree();
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 0);
    });

    it("works with fresh VFile", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: 'import Button from "./Button"',
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertExists(file.data);
      assertExists((file.data as any).imports);
    });

    it("handles multiline imports", () => {
      const tree = createTree({
        type: "mdxjsEsm",
        value: `import {
  Button,
  Card
} from "./components"`,
      });
      const file = new VFile();

      remarkMdxImports()(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });
  });
});
