import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { VFile } from "vfile";
import {
  remarkCodeBlocks,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./remark-mdx-utils.ts";
import type { Code, Paragraph, Root } from "mdast";

function createCode(lang: string, value: string, meta?: string): Code {
  return {
    type: "code",
    lang,
    value,
    meta,
  };
}

function createParagraph(...children: any[]): Paragraph {
  return {
    type: "paragraph",
    children,
  };
}

function createTree(...nodes: any[]): Root {
  return {
    type: "root",
    children: nodes,
  };
}

describe("remark-mdx-utils", () => {
  describe("remarkMdxRemoveParagraphs", () => {
    it("preserves root-level paragraphs with JSX text element", () => {
      // Root-level paragraphs are preserved - the plugin targets nested cases like <Button><p>text</p></Button>
      const jsxElement = {
        type: "mdxJsxTextElement",
        name: "Component",
        children: [],
      };
      const para = createParagraph(jsxElement);
      const tree = createTree(para);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("preserves root-level paragraphs with JSX flow element", () => {
      // Root-level paragraphs are preserved - the plugin targets nested cases like <Button><p>text</p></Button>
      const jsxElement = {
        type: "mdxJsxFlowElement",
        name: "Component",
        children: [],
      };
      const para = createParagraph(jsxElement);
      const tree = createTree(para);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("unwraps paragraphs inside JSX elements", () => {
      // Main use case: <Button><p>text</p></Button> => <Button>text</Button>
      const textNode = { type: "text", value: "Click me" };
      const para = createParagraph(textNode);
      const jsxParent = {
        type: "mdxJsxFlowElement",
        name: "Button",
        children: [para],
      };
      const tree = createTree(jsxParent);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      // The paragraph inside Button should be unwrapped
      const button = tree.children[0] as any;
      assertEquals(button.type, "mdxJsxFlowElement");
      assertEquals(button.children.length, 1);
      assertEquals(button.children[0].type, "text");
      assertEquals(button.children[0].value, "Click me");
    });

    it("keeps paragraph with multiple children", () => {
      const para = createParagraph(
        { type: "text", value: "Hello " },
        { type: "mdxJsxTextElement", name: "Component" },
      );
      const tree = createTree(para);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("keeps paragraph with text only", () => {
      const para = createParagraph({ type: "text", value: "Hello World" });
      const tree = createTree(para);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 1);
      assertEquals((tree.children[0] as any).type, "paragraph");
    });

    it("handles empty tree", () => {
      const tree: Root = {
        type: "root",
        children: [],
      };

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 0);
    });

    it("preserves multiple root-level paragraphs", () => {
      // Root-level paragraphs are preserved
      const jsxElement1 = { type: "mdxJsxFlowElement", name: "Comp1" };
      const jsxElement2 = { type: "mdxJsxFlowElement", name: "Comp2" };
      const para1 = createParagraph(jsxElement1);
      const para2 = createParagraph(jsxElement2);
      const tree = createTree(para1, para2);

      const plugin = remarkMdxRemoveParagraphs();
      plugin(tree);

      assertEquals(tree.children.length, 2);
      assertEquals((tree.children[0] as any).type, "paragraph");
      assertEquals((tree.children[1] as any).type, "paragraph");
    });
  });

  describe("remarkCodeBlocks", () => {
    it("adds language class", () => {
      const code = createCode("javascript", "const x = 1");
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertExists(props?.className);
      assertEquals(props.className.includes("language-javascript"), true);
    });

    it("handles code without language", () => {
      const code = createCode("", "const x = 1");
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.className, undefined);
    });

    it("extracts line numbers from meta", () => {
      const code = createCode("typescript", "const x = 1", "{1-3,5}");
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], "1-3,5");
    });

    it("handles meta without line numbers", () => {
      const code = createCode("typescript", "const x = 1", "some meta");
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], undefined);
    });

    it("handles code without meta", () => {
      const code = createCode("typescript", "const x = 1");
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props = (tree.children[0] as any).data?.hProperties;
      assertEquals(props?.["data-line-numbers"], undefined);
    });

    it("preserves existing data", () => {
      const code = createCode("typescript", "const x = 1");
      // deno-lint-ignore no-explicit-any
      (code as any).data = { customProp: "value" };
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      assertEquals((tree.children[0] as any).data.customProp, "value");
    });

    it("preserves existing hProperties", () => {
      const code = createCode("typescript", "const x = 1");
      code.data = { hProperties: { id: "custom-id" } };
      const tree = createTree(code);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      assertEquals((tree.children[0] as any).data.hProperties.id, "custom-id");
      assertExists((tree.children[0] as any).data.hProperties.className);
    });

    it("handles multiple code blocks", () => {
      const code1 = createCode("javascript", "const x = 1");
      const code2 = createCode("typescript", "const y = 2", "{1}");
      const tree = createTree(code1, code2);

      const plugin = remarkCodeBlocks();
      plugin(tree);

      const props1 = (tree.children[0] as any).data?.hProperties;
      const props2 = (tree.children[1] as any).data?.hProperties;

      assertEquals(props1.className.includes("language-javascript"), true);
      assertEquals(props2.className.includes("language-typescript"), true);
      assertEquals(props2["data-line-numbers"], "1");
    });
  });

  describe("remarkMdxImports", () => {
    it("extracts import paths", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: 'import Button from "./components/Button"',
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertExists((file.data as any).imports);
      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components/Button");
    });

    it("handles multiple imports", () => {
      const importNode1 = {
        type: "mdxjsEsm",
        value: 'import Button from "./Button"',
      };
      const importNode2 = {
        type: "mdxjsEsm",
        value: 'import Card from "./Card"',
      };
      const tree = createTree(importNode1, importNode2);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 2);
      assertEquals((file.data as any).imports[0], "./Button");
      assertEquals((file.data as any).imports[1], "./Card");
    });

    it("handles named imports", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: 'import { Button, Card } from "./components"',
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });

    it("handles namespace imports", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: 'import * as Components from "./components"',
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });

    it("handles side-effect imports", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: 'import "./styles.css"',
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./styles.css");
    });

    it("handles single quotes", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: "import Button from './Button'",
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports[0], "./Button");
    });

    it("handles non-import mdxjsEsm nodes", () => {
      const exportNode = {
        type: "mdxjsEsm",
        value: "export const x = 1",
      };
      const tree = createTree(exportNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 0);
    });

    it("handles empty tree", () => {
      const tree: Root = {
        type: "root",
        children: [],
      };
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 0);
    });

    it("works with fresh VFile", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: 'import Button from "./Button"',
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertExists(file.data);
      assertExists(file.data.imports);
    });

    it("handles multiline imports", () => {
      const importNode = {
        type: "mdxjsEsm",
        value: `import {
  Button,
  Card
} from "./components"`,
      };
      const tree = createTree(importNode);
      const file = new VFile();

      const plugin = remarkMdxImports();
      plugin(tree, file);

      assertEquals((file.data as any).imports.length, 1);
      assertEquals((file.data as any).imports[0], "./components");
    });
  });
});
