import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VFile } from "vfile";
import {
  getRehypePlugins,
  getRemarkPlugins,
  rehypeMdxComponents,
  rehypeNodePositions,
  remarkCodeBlocks,
  remarkMdxHeadings,
  remarkMdxImports,
  remarkMdxRemoveParagraphs,
} from "./plugins.ts";

type Plugin = ((...args: any[]) => void) | (() => (...args: any[]) => void);

function runPlugins(plugins: Plugin[], ...args: any[]): void {
  for (const p of plugins) {
    const plugin = typeof p === "function" ? (p as any)() : p;
    plugin(...args);
  }
}

function runRemark(tree: any, file: any, plugins: Plugin[]): void {
  runPlugins(plugins, tree, file);
}

function runRehype(tree: any, plugins: Plugin[]): void {
  runPlugins(plugins, tree);
}

describe("plugins", () => {
  describe("exports", () => {
    it("exports all plugins", () => {
      assertExists(remarkMdxHeadings);
      assertExists(remarkMdxRemoveParagraphs);
      assertExists(remarkCodeBlocks);
      assertExists(remarkMdxImports);
      assertExists(rehypeNodePositions);
      assertExists(rehypeMdxComponents);
      assertExists(getRemarkPlugins);
      assertExists(getRehypePlugins);
    });
  });

  describe("rehypeNodePositions", () => {
    it("returns a function", () => {
      assertEquals(typeof rehypeNodePositions(), "function");
    });

    it("injects position attributes on HTML elements", () => {
      const el: any = {
        type: "element",
        tagName: "h1",
        properties: {},
        position: {
          start: { line: 3, column: 1 },
        },
        children: [],
      };

      const tree: any = { type: "root", children: [el] };
      runRehype(tree, [() => rehypeNodePositions({ filePath: "docs/intro.md" })]);

      assertEquals(el.properties["data-node-file"], "docs/intro.md");
      assertEquals(el.properties["data-node-name"], "h1");
      assertEquals(el.properties["data-node-line"], 3);
      assertEquals(el.properties["data-node-column"], 0);
    });

    it("skips elements without position", () => {
      const el: any = {
        type: "element",
        tagName: "div",
        properties: {},
        children: [],
      };

      const tree: any = { type: "root", children: [el] };
      runRehype(tree, [() => rehypeNodePositions({ filePath: "test.md" })]);

      assertEquals(el.properties["data-node-line"], undefined);
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
