import { assertEquals, assertExists } from "std/assert/mod.ts";
import { remarkAddNodeId } from "./remark-node-id.ts";
import type { Heading, Paragraph, Root } from "mdast";

function createParagraph(text: string): Paragraph {
  return {
    type: "paragraph",
    children: [{ type: "text", value: text }],
  };
}

function _createHeading(text: string): Heading {
  return {
    type: "heading",
    depth: 1,
    children: [{ type: "text", value: text }],
  };
}

function createTree(...nodes: any[]): Root {
  return {
    type: "root",
    children: nodes,
  };
}

Deno.test("remark-node-id - adds node IDs to all nodes", () => {
  const tree = createTree(
    createParagraph("First"),
    createParagraph("Second"),
    createParagraph("Third"),
  );
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const para1 = tree.children[0] as any;
  const para2 = tree.children[1] as any;
  const para3 = tree.children[2] as any;

  assertExists(para1.data?.hProperties?.["data-node-id"]);
  assertExists(para2.data?.hProperties?.["data-node-id"]);
  assertExists(para3.data?.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - generates unique IDs", () => {
  const tree = createTree(
    createParagraph("First"),
    createParagraph("Second"),
    createParagraph("Third"),
  );
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const ids = tree.children.map((n: any) => n.data?.hProperties?.["data-node-id"]);
  const uniqueIds = new Set(ids);

  assertEquals(ids.length, uniqueIds.size);
});

Deno.test("remark-node-id - uses custom prefix", () => {
  const tree = createTree(createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId({ prefix: "custom" });
  plugin(tree, file);

  const nodeId = (tree.children[0] as any).data?.hProperties?.["data-node-id"];
  assertEquals(nodeId.startsWith("custom-"), true);
});

Deno.test("remark-node-id - includes position data by default", () => {
  const para = createParagraph("Test");
  para.position = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 5, offset: 4 },
  };
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const props = (tree.children[0] as any).data?.hProperties;
  assertExists(props?.["data-node-start"]);
  assertExists(props?.["data-node-end"]);
  assertExists(props?.["data-node-line"]);
});

Deno.test("remark-node-id - excludes position data when disabled", () => {
  const para = createParagraph("Test");
  para.position = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 5, offset: 4 },
  };
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId({ includePosition: false });
  plugin(tree, file);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.["data-node-start"], undefined);
  assertEquals(props?.["data-node-end"], undefined);
  assertEquals(props?.["data-node-line"], undefined);
});

Deno.test("remark-node-id - stores node map in file data", () => {
  const tree = createTree(createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertExists((file.data as any).nodeMap);
  assertEquals((file.data as any).nodeMap instanceof Map, true);
});

Deno.test("remark-node-id - stores node count in file data", () => {
  const tree = createTree(
    createParagraph("First"),
    createParagraph("Second"),
  );
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertExists((file.data as any).nodeCount);
  assertEquals(typeof (file.data as any).nodeCount, "number");
  assertEquals((file.data as any).nodeCount > 0, true);
});

Deno.test("remark-node-id - skips yaml nodes", () => {
  const yamlNode = {
    type: "yaml",
    value: "title: test",
  };
  const tree = createTree(yamlNode, createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data?.hProperties?.["data-node-id"], undefined);
  assertExists((tree.children[1] as any).data?.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - skips toml nodes", () => {
  const tomlNode = {
    type: "toml",
    value: 'title = "test"',
  };
  const tree = createTree(tomlNode, createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data?.hProperties?.["data-node-id"], undefined);
  assertExists((tree.children[1] as any).data?.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - skips mdxjsEsm nodes", () => {
  const mdxNode = {
    type: "mdxjsEsm",
    value: "export const x = 1",
  };
  const tree = createTree(mdxNode, createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data?.hProperties?.["data-node-id"], undefined);
  assertExists((tree.children[1] as any).data?.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - skips mdxjsFlow nodes", () => {
  const mdxFlow = {
    type: "mdxjsFlow",
    value: "const x = 1",
  };
  const tree = createTree(mdxFlow, createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data?.hProperties?.["data-node-id"], undefined);
  assertExists((tree.children[1] as any).data?.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - handles nodes without position", () => {
  const para = createParagraph("Test");
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const props = (tree.children[0] as any).data?.hProperties;
  assertExists(props?.["data-node-id"]);
  assertEquals(props?.["data-node-start"], undefined);
});

Deno.test("remark-node-id - stores correct position data", () => {
  const para = createParagraph("Test");
  para.position = {
    start: { line: 5, column: 1, offset: 100 },
    end: { line: 5, column: 10, offset: 109 },
  };
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const props = (tree.children[0] as any).data?.hProperties;
  assertEquals(props?.["data-node-start"], 100);
  assertEquals(props?.["data-node-end"], 109);
  assertEquals(props?.["data-node-line"], 5);
});

Deno.test("remark-node-id - preserves existing data properties", () => {
  const para = createParagraph("Test");
  // deno-lint-ignore no-explicit-any
  (para as any).data = { customProp: "value" };
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data.customProp, "value");
  assertExists((tree.children[0] as any).data.hProperties?.["data-node-id"]);
});

Deno.test("remark-node-id - preserves existing hProperties", () => {
  const para = createParagraph("Test");
  para.data = {
    hProperties: { className: "existing" },
  };
  const tree = createTree(para);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((tree.children[0] as any).data.hProperties.className, "existing");
  assertExists((tree.children[0] as any).data.hProperties["data-node-id"]);
});

Deno.test("remark-node-id - handles empty tree", () => {
  const tree: Root = {
    type: "root",
    children: [],
  };
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  assertEquals((file.data as any).nodeCount, 1);
  assertEquals((file.data as any).nodeMap.size, 1);
});

Deno.test("remark-node-id - initializes file data if missing", () => {
  const tree = createTree(createParagraph("Test"));
  const file = {} as any;

  const plugin = remarkAddNodeId();
  plugin(tree as Root, file);

  assertExists((file as any).data);
  assertExists(((file as any).data as any).nodeMap);
  assertExists(((file as any).data as any).nodeCount);
});

Deno.test("remark-node-id - stores node type in map", () => {
  const tree = createTree(createParagraph("Test"));
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const nodeInfo: any = Array.from((file.data as any).nodeMap.values())[1];
  assertEquals(nodeInfo.type, "paragraph");
});

Deno.test("remark-node-id - stores node value in map if present", () => {
  const codeNode = {
    type: "code",
    lang: "js",
    value: 'console.log("test")',
  };
  const tree = createTree(codeNode);
  const file = { data: {} };

  const plugin = remarkAddNodeId();
  plugin(tree, file);

  const nodeInfo: any = Array.from((file.data as any).nodeMap.values())[1];
  assertEquals(nodeInfo.value, 'console.log("test")');
});
