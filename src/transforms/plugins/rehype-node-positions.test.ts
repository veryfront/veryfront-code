import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rehypeNodePositions } from "./rehype-node-positions.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

function makeElement(tagName: string, line: number, column: number): Any {
  return {
    type: "element",
    tagName,
    properties: {},
    position: { start: { line, column } },
    children: [],
  };
}

function makeMdxNode(
  type: "mdxJsxFlowElement" | "mdxJsxTextElement",
  name: string,
  line: number,
  column: number,
): Any {
  return {
    type,
    name,
    attributes: [],
    position: { start: { line, column } },
    children: [],
  };
}

function runPlugin(tree: Any, options: { filePath?: string } = {}): void {
  rehypeNodePositions(options)(tree);
}

describe("rehype-node-positions", () => {
  describe("HTML elements", () => {
    it("injects all data-node-* attributes on elements with position", () => {
      const el = makeElement("h1", 3, 1);
      const tree = { type: "root", children: [el] };

      runPlugin(tree, { filePath: "docs/intro.md" });

      assertEquals(el.properties["data-node-file"], "docs/intro.md");
      assertEquals(el.properties["data-node-name"], "h1");
      assertEquals(el.properties["data-node-line"], "3");
      assertEquals(el.properties["data-node-column"], "0"); // column - 1
      assertEquals(el.properties["data-node-source"], "md");
    });

    it("converts column to 0-based", () => {
      const el = makeElement("p", 10, 5);
      const tree = { type: "root", children: [el] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(el.properties["data-node-column"], "4");
    });

    it("skips elements without position", () => {
      const el: Any = {
        type: "element",
        tagName: "div",
        properties: {},
        children: [],
      };
      const tree = { type: "root", children: [el] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(el.properties["data-node-line"], undefined);
      assertEquals(el.properties["data-node-name"], undefined);
    });

    it("omits data-node-file when filePath is not provided", () => {
      const el = makeElement("p", 1, 1);
      const tree = { type: "root", children: [el] };

      runPlugin(tree);

      assertEquals(el.properties["data-node-file"], undefined);
      assertEquals(el.properties["data-node-name"], "p");
      assertEquals(el.properties["data-node-line"], "1");
    });

    it("initializes properties if missing", () => {
      const el: Any = {
        type: "element",
        tagName: "span",
        position: { start: { line: 2, column: 3 } },
        children: [],
      };
      const tree = { type: "root", children: [el] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(el.properties["data-node-name"], "span");
    });

    it("preserves existing properties", () => {
      const el = makeElement("div", 1, 1);
      el.properties.id = "existing";
      el.properties.className = ["foo"];
      const tree = { type: "root", children: [el] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(el.properties.id, "existing");
      assertEquals(el.properties.className[0], "foo");
      assertEquals(el.properties["data-node-name"], "div");
    });

    it("handles nested elements", () => {
      const inner = makeElement("span", 5, 3);
      const outer = makeElement("div", 4, 1);
      outer.children = [inner];
      const tree = { type: "root", children: [outer] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(outer.properties["data-node-name"], "div");
      assertEquals(outer.properties["data-node-line"], "4");
      assertEquals(inner.properties["data-node-name"], "span");
      assertEquals(inner.properties["data-node-line"], "5");
    });
  });

  describe("MDX JSX nodes", () => {
    it("injects attributes on mdxJsxFlowElement", () => {
      const node = makeMdxNode("mdxJsxFlowElement", "Button", 7, 1);
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "docs/page.mdx" });

      const attrs = node.attributes;
      assertEquals(attrs.length, 4);
      assertEquals(attrs[0], {
        type: "mdxJsxAttribute",
        name: "data-node-file",
        value: "docs/page.mdx",
      });
      assertEquals(attrs[1], { type: "mdxJsxAttribute", name: "data-node-name", value: "Button" });
      assertEquals(attrs[2], { type: "mdxJsxAttribute", name: "data-node-line", value: "7" });
      assertEquals(attrs[3], { type: "mdxJsxAttribute", name: "data-node-column", value: "0" });
    });

    it("injects attributes on mdxJsxTextElement", () => {
      const node = makeMdxNode("mdxJsxTextElement", "Badge", 12, 5);
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "docs/page.mdx" });

      const fileAttr = node.attributes.find((a: Any) => a.name === "data-node-file");
      const nameAttr = node.attributes.find((a: Any) => a.name === "data-node-name");
      assertEquals(fileAttr?.value, "docs/page.mdx");
      assertEquals(nameAttr?.value, "Badge");
    });

    it("uses 'unknown' for unnamed MDX nodes", () => {
      const node: Any = {
        type: "mdxJsxFlowElement",
        attributes: [],
        position: { start: { line: 1, column: 1 } },
        children: [],
      };
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "test.mdx" });

      const nameAttr = node.attributes.find((a: Any) => a.name === "data-node-name");
      assertEquals(nameAttr?.value, "unknown");
    });

    it("skips MDX nodes without position", () => {
      const node: Any = {
        type: "mdxJsxFlowElement",
        name: "Card",
        attributes: [],
        children: [],
      };
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "test.mdx" });

      assertEquals(node.attributes.length, 0);
    });

    it("omits data-node-file when filePath is not provided", () => {
      const node = makeMdxNode("mdxJsxFlowElement", "Alert", 3, 1);
      const tree = { type: "root", children: [node] };

      runPlugin(tree);

      assertEquals(node.attributes.length, 3);
      const fileAttr = node.attributes.find((a: Any) => a.name === "data-node-file");
      assertEquals(fileAttr, undefined);
    });

    it("initializes attributes array if missing", () => {
      const node: Any = {
        type: "mdxJsxFlowElement",
        name: "Callout",
        position: { start: { line: 2, column: 1 } },
        children: [],
      };
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "test.mdx" });

      assertEquals(Array.isArray(node.attributes), true);
      assertEquals(node.attributes.length, 4);
    });

    it("preserves existing attributes", () => {
      const node = makeMdxNode("mdxJsxFlowElement", "Button", 1, 1);
      node.attributes.push({ type: "mdxJsxAttribute", name: "variant", value: "primary" });
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "test.mdx" });

      const variantAttr = node.attributes.find((a: Any) => a.name === "variant");
      assertEquals(variantAttr?.value, "primary");
      assertEquals(node.attributes.length, 5); // 1 existing + 4 injected
    });

    it("converts column and line to strings for MDX attributes", () => {
      const node = makeMdxNode("mdxJsxFlowElement", "Box", 15, 8);
      const tree = { type: "root", children: [node] };

      runPlugin(tree, { filePath: "test.mdx" });

      const lineAttr = node.attributes.find((a: Any) => a.name === "data-node-line");
      const colAttr = node.attributes.find((a: Any) => a.name === "data-node-column");
      assertEquals(lineAttr?.value, "15");
      assertEquals(colAttr?.value, "7"); // 8 - 1
    });
  });

  describe("mixed trees", () => {
    it("handles tree with both HTML elements and MDX nodes", () => {
      const el = makeElement("h1", 1, 1);
      const mdx = makeMdxNode("mdxJsxFlowElement", "Alert", 3, 1);
      const tree = { type: "root", children: [el, mdx] };

      runPlugin(tree, { filePath: "docs/page.mdx" });

      assertEquals(el.properties["data-node-name"], "h1");
      assertEquals(el.properties["data-node-source"], "md");
      const nameAttr = mdx.attributes.find((a: Any) => a.name === "data-node-name");
      assertEquals(nameAttr?.value, "Alert");
      const sourceAttr = mdx.attributes.find((a: Any) => a.name === "data-node-source");
      assertEquals(sourceAttr, undefined);
    });

    it("ignores unrelated node types", () => {
      const textNode: Any = { type: "text", value: "hello" };
      const commentNode: Any = { type: "comment", value: "a comment" };
      const tree = { type: "root", children: [textNode, commentNode] };

      runPlugin(tree, { filePath: "test.md" });

      assertEquals(textNode.properties, undefined);
      assertEquals(commentNode.properties, undefined);
    });
  });
});
