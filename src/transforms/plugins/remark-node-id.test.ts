import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { remarkAddNodeId } from "./remark-node-id.ts";
import type { Paragraph, Root } from "mdast";

function createParagraph(text: string): Paragraph {
  return {
    type: "paragraph",
    children: [{ type: "text", value: text }],
  };
}

function createTree(...nodes: Root["children"]): Root {
  return {
    type: "root",
    children: nodes,
  };
}

function runPlugin(tree: Root, file: any, options?: Parameters<typeof remarkAddNodeId>[0]): void {
  const plugin = remarkAddNodeId(options as any);
  plugin(tree, file);
}

function getNodeId(node: any): unknown {
  return node?.data?.hProperties?.["data-node-id"];
}

function getHProperties(node: any): any {
  return node?.data?.hProperties;
}

describe("remark-node-id", () => {
  it("adds node IDs to all nodes", () => {
    const tree = createTree(
      createParagraph("First"),
      createParagraph("Second"),
      createParagraph("Third"),
    );
    const file = { data: {} };

    runPlugin(tree, file);

    for (const node of tree.children as any[]) {
      assertExists(getNodeId(node));
    }
  });

  it("generates unique IDs", () => {
    const tree = createTree(
      createParagraph("First"),
      createParagraph("Second"),
      createParagraph("Third"),
    );
    const file = { data: {} };

    runPlugin(tree, file);

    const ids = (tree.children as any[]).map(getNodeId);
    const uniqueIds = new Set(ids);

    assertEquals(ids.length, uniqueIds.size);
  });

  it("uses custom prefix", () => {
    const tree = createTree(createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file, { prefix: "custom" });

    const nodeId = getNodeId(tree.children[0] as any) as string;
    assertEquals(nodeId.startsWith("custom-"), true);
  });

  it("includes position data by default", () => {
    const para = createParagraph("Test");
    para.position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 5, offset: 4 },
    };
    const tree = createTree(para);
    const file = { data: {} };

    runPlugin(tree, file);

    const props = getHProperties(tree.children[0] as any);
    assertExists(props?.["data-node-start"]);
    assertExists(props?.["data-node-end"]);
    assertExists(props?.["data-node-line"]);
  });

  it("excludes position data when disabled", () => {
    const para = createParagraph("Test");
    para.position = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 5, offset: 4 },
    };
    const tree = createTree(para);
    const file = { data: {} };

    runPlugin(tree, file, { includePosition: false });

    const props = getHProperties(tree.children[0] as any);
    assertEquals(props?.["data-node-start"], undefined);
    assertEquals(props?.["data-node-end"], undefined);
    assertEquals(props?.["data-node-line"], undefined);
  });

  it("stores node map in file data", () => {
    const tree = createTree(createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    assertExists(file.data.nodeMap);
    assertEquals(file.data.nodeMap instanceof Map, true);
  });

  it("stores node count in file data", () => {
    const tree = createTree(
      createParagraph("First"),
      createParagraph("Second"),
    );
    const file = { data: {} };

    runPlugin(tree, file);

    assertExists(file.data.nodeCount);
    assertEquals(typeof file.data.nodeCount, "number");
    assertEquals(file.data.nodeCount > 0, true);
  });

  it("skips yaml nodes", () => {
    const yamlNode = {
      type: "yaml",
      value: "title: test",
    };
    const tree = createTree(yamlNode as any, createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    assertEquals(getNodeId(tree.children[0] as any), undefined);
    assertExists(getNodeId(tree.children[1] as any));
  });

  it("skips toml nodes", () => {
    const tomlNode = {
      type: "toml",
      value: 'title = "test"',
    };
    const tree = createTree(tomlNode as any, createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    assertEquals(getNodeId(tree.children[0] as any), undefined);
    assertExists(getNodeId(tree.children[1] as any));
  });

  it("skips mdxjsEsm nodes", () => {
    const mdxNode = {
      type: "mdxjsEsm",
      value: "export const x = 1",
    };
    const tree = createTree(mdxNode as any, createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    assertEquals(getNodeId(tree.children[0] as any), undefined);
    assertExists(getNodeId(tree.children[1] as any));
  });

  it("skips mdxjsFlow nodes", () => {
    const mdxFlow = {
      type: "mdxjsFlow",
      value: "const x = 1",
    };
    const tree = createTree(mdxFlow as any, createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    assertEquals(getNodeId(tree.children[0] as any), undefined);
    assertExists(getNodeId(tree.children[1] as any));
  });

  it("handles nodes without position", () => {
    const tree = createTree(createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    const props = getHProperties(tree.children[0] as any);
    assertExists(props?.["data-node-id"]);
    assertEquals(props?.["data-node-start"], undefined);
  });

  it("stores correct position data", () => {
    const para = createParagraph("Test");
    para.position = {
      start: { line: 5, column: 1, offset: 100 },
      end: { line: 5, column: 10, offset: 109 },
    };
    const tree = createTree(para);
    const file = { data: {} };

    runPlugin(tree, file);

    const props = getHProperties(tree.children[0] as any);
    assertEquals(props?.["data-node-start"], 100);
    assertEquals(props?.["data-node-end"], 109);
    assertEquals(props?.["data-node-line"], 5);
  });

  it("preserves existing data properties", () => {
    const para = createParagraph("Test");
    (para as any).data = { customProp: "value" };
    const tree = createTree(para);
    const file = { data: {} };

    runPlugin(tree, file);

    const node = tree.children[0] as any;
    assertEquals(node.data.customProp, "value");
    assertExists(node.data.hProperties?.["data-node-id"]);
  });

  it("preserves existing hProperties", () => {
    const para = createParagraph("Test");
    para.data = {
      hProperties: { className: "existing" },
    };
    const tree = createTree(para);
    const file = { data: {} };

    runPlugin(tree, file);

    const node = tree.children[0] as any;
    assertEquals(node.data.hProperties.className, "existing");
    assertExists(node.data.hProperties["data-node-id"]);
  });

  it("handles empty tree", () => {
    const tree: Root = {
      type: "root",
      children: [],
    };
    const file = { data: {} };

    runPlugin(tree, file);

    assertEquals(file.data.nodeCount, 1);
    assertEquals(file.data.nodeMap.size, 1);
  });

  it("initializes file data if missing", () => {
    const tree = createTree(createParagraph("Test"));
    const file: any = {};

    runPlugin(tree, file);

    assertExists(file.data);
    assertExists(file.data.nodeMap);
    assertExists(file.data.nodeCount);
  });

  it("stores node type in map", () => {
    const tree = createTree(createParagraph("Test"));
    const file = { data: {} };

    runPlugin(tree, file);

    const nodeInfo: any = Array.from(file.data.nodeMap.values())[1];
    assertEquals(nodeInfo.type, "paragraph");
  });

  it("stores node value in map if present", () => {
    const codeNode = {
      type: "code",
      lang: "js",
      value: 'console.log("test")',
    };
    const tree = createTree(codeNode as any);
    const file = { data: {} };

    runPlugin(tree, file);

    const nodeInfo: any = Array.from(file.data.nodeMap.values())[1];
    assertEquals(nodeInfo.value, 'console.log("test")');
  });
});
