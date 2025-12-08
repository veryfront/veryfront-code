import { assertEquals, assertExists } from "std/assert/mod.ts";
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

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs removes wrapper from JSX text element", () => {
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
  assertEquals((tree.children[0] as any).type, "mdxJsxTextElement");
});

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs removes wrapper from JSX flow element", () => {
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
  assertEquals((tree.children[0] as any).type, "mdxJsxFlowElement");
});

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs keeps paragraph with multiple children", () => {
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

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs keeps paragraph with text only", () => {
  const para = createParagraph({ type: "text", value: "Hello World" });
  const tree = createTree(para);

  const plugin = remarkMdxRemoveParagraphs();
  plugin(tree);

  assertEquals(tree.children.length, 1);
  assertEquals((tree.children[0] as any).type, "paragraph");
});

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs handles empty tree", () => {
  const tree: Root = {
    type: "root",
    children: [],
  };

  const plugin = remarkMdxRemoveParagraphs();
  plugin(tree);

  assertEquals(tree.children.length, 0);
});

Deno.test("remark-mdx-utils - remarkMdxRemoveParagraphs handles multiple paragraphs", () => {
  const jsxElement1 = { type: "mdxJsxFlowElement", name: "Comp1" };
  const jsxElement2 = { type: "mdxJsxFlowElement", name: "Comp2" };
  const para1 = createParagraph(jsxElement1);
  const para2 = createParagraph(jsxElement2);
  const tree = createTree(para1, para2);

  const plugin = remarkMdxRemoveParagraphs();
  plugin(tree);

  assertEquals(tree.children.length, 2);
  assertEquals((tree.children[0] as any).type, "mdxJsxFlowElement");
  assertEquals((tree.children[1] as any).type, "mdxJsxFlowElement");
});

Deno.test("remark-mdx-utils - remarkCodeBlocks adds language class", () => {
  const code = createCode("javascript", "const x = 1");
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  const props = (tree.children[0] as any).data?.hProperties;
  assertExists(props?.className);
  assertEquals(props.className.includes("language-javascript"), true);
});

Deno.test("remark-mdx-utils - remarkCodeBlocks handles code without language", () => {
  const code = createCode("", "const x = 1");
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.className, undefined);
});

Deno.test("remark-mdx-utils - remarkCodeBlocks extracts line numbers from meta", () => {
  const code = createCode("typescript", "const x = 1", "{1-3,5}");
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.["data-line-numbers"], "1-3,5");
});

Deno.test("remark-mdx-utils - remarkCodeBlocks handles meta without line numbers", () => {
  const code = createCode("typescript", "const x = 1", "some meta");
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.["data-line-numbers"], undefined);
});

Deno.test("remark-mdx-utils - remarkCodeBlocks handles code without meta", () => {
  const code = createCode("typescript", "const x = 1");
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.["data-line-numbers"], undefined);
});

Deno.test("remark-mdx-utils - remarkCodeBlocks preserves existing data", () => {
  const code = createCode("typescript", "const x = 1");
  // deno-lint-ignore no-explicit-any
  (code as any).data = { customProp: "value" };
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  assertEquals((tree.children[0] as any).data.customProp, "value");
});

Deno.test("remark-mdx-utils - remarkCodeBlocks preserves existing hProperties", () => {
  const code = createCode("typescript", "const x = 1");
  code.data = { hProperties: { id: "custom-id" } };
  const tree = createTree(code);

  const plugin = remarkCodeBlocks();
  plugin(tree);

  assertEquals((tree.children[0] as any).data.hProperties.id, "custom-id");
  assertExists((tree.children[0] as any).data.hProperties.className);
});

Deno.test("remark-mdx-utils - remarkMdxImports extracts import paths", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: 'import Button from "./components/Button"',
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertExists((file.data as any).imports);
  assertEquals((file.data as any).imports.length, 1);
  assertEquals((file.data as any).imports[0], "./components/Button");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles multiple imports", () => {
  const importNode1 = {
    type: "mdxjsEsm",
    value: 'import Button from "./Button"',
  };
  const importNode2 = {
    type: "mdxjsEsm",
    value: 'import Card from "./Card"',
  };
  const tree = createTree(importNode1, importNode2);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 2);
  assertEquals((file.data as any).imports[0], "./Button");
  assertEquals((file.data as any).imports[1], "./Card");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles named imports", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: 'import { Button, Card } from "./components"',
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 1);
  assertEquals((file.data as any).imports[0], "./components");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles namespace imports", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: 'import * as Components from "./components"',
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 1);
  assertEquals((file.data as any).imports[0], "./components");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles side-effect imports", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: 'import "./styles.css"',
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 1);
  assertEquals((file.data as any).imports[0], "./styles.css");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles single quotes", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: "import Button from './Button'",
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports[0], "./Button");
});

Deno.test("remark-mdx-utils - remarkMdxImports handles non-import mdxjsEsm nodes", () => {
  const exportNode = {
    type: "mdxjsEsm",
    value: "export const x = 1",
  };
  const tree = createTree(exportNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 0);
});

Deno.test("remark-mdx-utils - remarkMdxImports handles empty tree", () => {
  const tree: Root = {
    type: "root",
    children: [],
  };
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 0);
});

Deno.test("remark-mdx-utils - remarkMdxImports initializes file data if missing", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: 'import Button from "./Button"',
  };
  const tree = createTree(importNode);
  const file = {} as any;

  const plugin = remarkMdxImports();
  plugin(tree as Root, file);

  assertExists((file as any).data);
  assertExists(((file as any).data as any).imports);
});

Deno.test("remark-mdx-utils - remarkMdxImports handles multiline imports", () => {
  const importNode = {
    type: "mdxjsEsm",
    value: `import {
  Button,
  Card
} from "./components"`,
  };
  const tree = createTree(importNode);
  const file = { data: {} };

  const plugin = remarkMdxImports();
  plugin(tree, file);

  assertEquals((file.data as any).imports.length, 1);
  assertEquals((file.data as any).imports[0], "./components");
});

Deno.test("remark-mdx-utils - remarkCodeBlocks handles multiple code blocks", () => {
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
