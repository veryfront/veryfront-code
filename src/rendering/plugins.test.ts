import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VFile } from "vfile";
import {
  getRehypePlugins,
  getRemarkPlugins,
  rehypeMdxComponents,
  rehypePreserveNodeIds,
  remarkAddNodeId,
  remarkCodeBlocks,
  remarkMdxHeadings,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./plugins.ts";

function runRemark(tree: any, file: any, plugins: any[]): void {
  for (const p of plugins) {
    const plugin = typeof p === "function" ? p() : p;
    plugin(tree, file);
  }
}

function runRehype(tree: any, plugins: any[]): void {
  for (const p of plugins) {
    const plugin = typeof p === "function" ? p() : p;
    plugin(tree);
  }
}

describe("plugins", () => {
  describe("exports", () => {
    it("exports all plugins", () => {
      assertExists(remarkAddNodeId);
      assertExists(remarkMdxHeadings);
      assertExists(remarkMdxRemoveParagraphs);
      assertExists(remarkCodeBlocks);
      assertExists(remarkMdxImports);
      assertExists(rehypePreserveNodeIds);
      assertExists(rehypeMdxComponents);
      assertExists(getRemarkPlugins);
      assertExists(getRehypePlugins);
    });
  });

  describe("remarkAddNodeId", () => {
    it("returns a function", () => {
      assertEquals(typeof remarkAddNodeId(), "function");
    });

    it("accepts options", () => {
      assertEquals(
        typeof remarkAddNodeId({ prefix: "test", includePosition: false }),
        "function",
      );
    });

    it("adds node IDs to elements", () => {
      const plugin = remarkAddNodeId({ prefix: "test" });

      const tree: any = {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "Hello world" }],
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 12, offset: 11 },
            },
          },
        ],
      };

      plugin(tree, {});

      const paragraph = tree.children[0];
      assertExists(paragraph.data);
      assertExists(paragraph.data.hProperties);
      assertEquals(paragraph.data.hProperties["data-node-id"], "test-1");
    });

    it("adds ids and counts", () => {
      const tree: any = {
        type: "root",
        children: [
          {
            type: "paragraph",
            position: {
              start: { offset: 0, line: 1 },
              end: { offset: 10, line: 1 },
            },
            children: [{ type: "text", value: "hi" }],
          },
        ],
      };

      const file = new VFile();
      runRemark(tree, file, [() => remarkAddNodeId({ prefix: "x" })]);

      assertEquals(file.data.nodeCount, 3);

      const para = tree.children[0];
      assert(para.data?.hProperties?.["data-node-id"]?.startsWith("x-"));
    });
  });

  describe("remarkMdxHeadings", () => {
    it("returns a function", () => {
      assertEquals(typeof remarkMdxHeadings(), "function");
    });

    it("extracts headings from tree", () => {
      const plugin = remarkMdxHeadings();

      const tree: any = {
        type: "root",
        children: [
          {
            type: "heading",
            depth: 1,
            children: [{ type: "text", value: "Main Title" }],
          },
          {
            type: "heading",
            depth: 2,
            children: [{ type: "text", value: "Subtitle" }],
          },
        ],
      };

      const file = new VFile();
      plugin(tree, file);

      const headings = file.data.headings;
      assert(Array.isArray(headings));
      assertEquals(headings.length, 2);
    });

    it("extracts and injects headings export", () => {
      const tree: any = {
        type: "root",
        children: [
          {
            type: "heading",
            depth: 2,
            children: [{ type: "text", value: "Hello World" }],
          },
        ],
      };

      const file = new VFile();
      runRemark(tree, file, [remarkMdxHeadings]);

      const headings = file.data.headings;
      assert(Array.isArray(headings));
      assertEquals(headings.length, 1);
      assertEquals(tree.children[0].type, "mdxjsEsm");
    });
  });

  describe("remarkMdxRemoveParagraphs", () => {
    it("unwraps paragraph inside JSX component", () => {
      const para: any = {
        type: "paragraph",
        children: [{ type: "text", value: "Hello" }],
      };

      const jsxComponent: any = {
        type: "mdxJsxFlowElement",
        name: "Button",
        children: [para],
      };

      const tree: any = { type: "root", children: [jsxComponent] };
      runRemark(tree, {}, [remarkMdxRemoveParagraphs]);

      assertEquals(jsxComponent.children[0].type, "text");
      assertEquals(jsxComponent.children[0].value, "Hello");
    });
  });

  describe("remarkCodeBlocks", () => {
    it("returns a function", () => {
      assertEquals(typeof remarkCodeBlocks(), "function");
    });

    it("annotates language and meta", () => {
      const code: any = {
        type: "code",
        lang: "ts",
        meta: "{1-2}",
        value: "const a=1",
      };

      const tree: any = { type: "root", children: [code] };
      runRemark(tree, {}, [remarkCodeBlocks]);

      assertEquals(code.data.hProperties.className[0], "language-ts");
      assertEquals(code.data.hProperties["data-line-numbers"], "1-2");
    });
  });

  describe("remarkMdxImports", () => {
    it("returns a function", () => {
      assertEquals(typeof remarkMdxImports(), "function");
    });
  });

  describe("rehypePreserveNodeIds", () => {
    it("returns a function", () => {
      assertEquals(typeof rehypePreserveNodeIds(), "function");
    });

    it("copies data-node-* properties", () => {
      const el: any = {
        type: "element",
        tagName: "div",
        data: { hProperties: { "data-node-start": 1 } },
        properties: {},
      };

      const tree: any = { type: "root", children: [el] };
      runRehype(tree, [rehypePreserveNodeIds]);

      assertEquals(el.properties["data-node-start"], 1);
    });
  });

  describe("rehypeMdxComponents", () => {
    it("returns a function", () => {
      assertEquals(typeof rehypeMdxComponents(), "function");
    });

    it("tags mdx nodes with component name", () => {
      const node: any = {
        type: "mdxJsxFlowElement",
        name: "MyX",
        data: { hProperties: {} },
      };

      const tree: any = { type: "root", children: [node] };
      runRehype(tree, [rehypeMdxComponents]);

      assertEquals(node.data.hProperties["data-mdx-component"], "MyX");
    });
  });

  describe("getRemarkPlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRemarkPlugins();
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length > 0, true);
    });
  });

  describe("getRehypePlugins", () => {
    it("returns array of plugins", async () => {
      const plugins = await getRehypePlugins();
      assertEquals(Array.isArray(plugins), true);
      assertEquals(plugins.length > 0, true);
    });
  });
});
