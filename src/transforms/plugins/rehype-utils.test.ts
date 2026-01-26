import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rehypeMdxComponents, rehypePreserveNodeIds } from "./rehype-utils.ts";
import type { Element, Root } from "hast";

// deno-lint-ignore no-explicit-any
function setElementData(element: Element, data: any): void {
  element.data = data;
}

function createElement(
  tagName: string,
  properties: Record<string, any> = {},
  children: any[] = [],
): Element {
  return {
    type: "element",
    tagName,
    properties,
    children,
  };
}

function createTree(...children: Element[]): Root {
  return { type: "root", children };
}

function runPreserveNodeIdsTest(
  attribute: "data-node-id" | "data-node-start" | "data-node-end" | "data-node-line",
  value: string | number,
): void {
  const element = createElement("p");
  setElementData(element, { hProperties: { [attribute]: value } });
  const tree = createTree(element);

  rehypePreserveNodeIds()(tree);

  assertEquals(element.properties?.[attribute], value);
}

describe("rehype-utils", () => {
  describe("rehypePreserveNodeIds", () => {
    it("preserves data-node-id", () => {
      runPreserveNodeIdsTest("data-node-id", "node-123");
    });

    it("preserves data-node-start", () => {
      runPreserveNodeIdsTest("data-node-start", 100);
    });

    it("preserves data-node-end", () => {
      runPreserveNodeIdsTest("data-node-end", 200);
    });

    it("preserves data-node-line", () => {
      runPreserveNodeIdsTest("data-node-line", 5);
    });

    it("preserves multiple data attributes", () => {
      const element = createElement("p");
      setElementData(element, {
        hProperties: {
          "data-node-id": "node-123",
          "data-node-start": 100,
          "data-node-end": 200,
          "data-node-line": 5,
        },
      });
      const tree = createTree(element);

      rehypePreserveNodeIds()(tree);

      assertEquals(element.properties?.["data-node-id"], "node-123");
      assertEquals(element.properties?.["data-node-start"], 100);
      assertEquals(element.properties?.["data-node-end"], 200);
      assertEquals(element.properties?.["data-node-line"], 5);
    });

    it("ignores non-data-node attributes", () => {
      const element = createElement("p");
      setElementData(element, {
        hProperties: {
          "data-custom": "value",
          className: "test",
        },
      });
      const tree = createTree(element);

      rehypePreserveNodeIds()(tree);

      assertEquals(element.properties?.["data-custom"], undefined);
      assertEquals(element.properties?.["className"], undefined);
    });

    it("initializes properties if missing", () => {
      const element = createElement("p");
      element.properties = undefined as any;
      setElementData(element, { hProperties: { "data-node-id": "node-123" } });
      const tree = createTree(element);

      rehypePreserveNodeIds()(tree);

      assertExists(element.properties);
      assertEquals(element.properties?.["data-node-id"], "node-123");
    });

    it("handles elements without data", () => {
      const element = createElement("p");
      const tree = createTree(element);

      rehypePreserveNodeIds()(tree);

      assertExists(element.properties);
    });

    it("handles nested elements", () => {
      const inner = createElement("span");
      setElementData(inner, { hProperties: { "data-node-id": "inner-123" } });

      const outer = createElement("div", {}, [inner]);
      setElementData(outer, { hProperties: { "data-node-id": "outer-456" } });

      const tree = createTree(outer);

      rehypePreserveNodeIds()(tree);

      assertEquals(outer.properties?.["data-node-id"], "outer-456");
      assertEquals(inner.properties?.["data-node-id"], "inner-123");
    });
  });

  describe("rehypeMdxComponents", () => {
    it("adds data attribute to MDX component", () => {
      const mdxComponent = { type: "mdxJsxFlowElement", name: "Button" };
      const tree = { type: "root", children: [mdxComponent] };

      rehypeMdxComponents()(tree);

      assertExists((mdxComponent as any).data);
      assertExists((mdxComponent as any).data.hProperties);
      assertEquals((mdxComponent as any).data.hProperties["data-mdx-component"], "Button");
    });

    it("handles multiple components", () => {
      const mdxComponent1 = { type: "mdxJsxFlowElement", name: "Button" };
      const mdxComponent2 = { type: "mdxJsxFlowElement", name: "Card" };
      const tree = { type: "root", children: [mdxComponent1, mdxComponent2] };

      rehypeMdxComponents()(tree);

      assertEquals((mdxComponent1 as any).data.hProperties["data-mdx-component"], "Button");
      assertEquals((mdxComponent2 as any).data.hProperties["data-mdx-component"], "Card");
    });

    it("initializes data if missing", () => {
      const mdxComponent = { type: "mdxJsxFlowElement", name: "Button" };
      const tree = { type: "root", children: [mdxComponent] };

      rehypeMdxComponents()(tree);

      assertExists((mdxComponent as any).data);
      assertExists((mdxComponent as any).data.hProperties);
    });

    it("preserves existing data", () => {
      const mdxComponent = {
        type: "mdxJsxFlowElement",
        name: "Button",
        data: { customProp: "value" },
      };
      const tree = { type: "root", children: [mdxComponent] };

      rehypeMdxComponents()(tree);

      assertEquals((mdxComponent as any).data.customProp, "value");
      assertEquals((mdxComponent as any).data.hProperties["data-mdx-component"], "Button");
    });

    it("preserves existing hProperties", () => {
      const mdxComponent = {
        type: "mdxJsxFlowElement",
        name: "Button",
        data: { hProperties: { id: "custom-id" } },
      };
      const tree = { type: "root", children: [mdxComponent] };

      rehypeMdxComponents()(tree);

      assertEquals((mdxComponent as any).data.hProperties.id, "custom-id");
      assertEquals((mdxComponent as any).data.hProperties["data-mdx-component"], "Button");
    });
  });
});
