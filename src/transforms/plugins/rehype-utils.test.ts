import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rehypeAddClasses, rehypeMdxComponents, rehypePreserveNodeIds } from "./rehype-utils.ts";
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

function runAddClassesTest(tagName: string, expected: string): void {
  const element = createElement(tagName);
  const tree = createTree(element);

  rehypeAddClasses()(tree);

  const classes = element.properties?.className as string[];
  assertEquals(classes[0], expected);
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

  describe("rehypeAddClasses", () => {
    it("adds classes to paragraph", () => {
      const element = createElement("p");
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      assertExists(element.properties?.className);
      assertEquals((element.properties?.className as string[]).includes("mb-4"), true);
    });

    it("adds classes to h1", () => {
      runAddClassesTest("h1", "text-4xl font-bold mb-8 mt-12");
    });

    it("adds classes to h2", () => {
      runAddClassesTest("h2", "text-3xl font-bold mb-6 mt-10");
    });

    it("adds classes to h3", () => {
      runAddClassesTest("h3", "text-2xl font-bold mb-4 mt-8");
    });

    it("adds classes to anchor", () => {
      runAddClassesTest("a", "text-blue-600 hover:text-blue-800 underline");
    });

    it("adds classes to inline code", () => {
      runAddClassesTest("code", "px-1 py-0.5 bg-gray-100 text-gray-900 rounded text-sm");
    });

    it("adds classes to code block", () => {
      const element = createElement("code", { className: ["language-javascript"] });
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      const classes = element.properties?.className as string[];
      assertEquals(classes.includes("language-javascript"), true);
      assertEquals(classes[1], "block p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto");
    });

    it("adds classes to blockquote", () => {
      runAddClassesTest("blockquote", "border-l-4 border-gray-300 pl-4 italic");
    });

    it("adds classes to ul", () => {
      runAddClassesTest("ul", "list-disc list-inside mb-4");
    });

    it("adds classes to ol", () => {
      runAddClassesTest("ol", "list-decimal list-inside mb-4");
    });

    it("adds classes to li", () => {
      const element = createElement("li");
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      const classes = element.properties?.className as string[];
      assertEquals(classes.includes("mb-2"), true);
    });

    it("converts string className to array", () => {
      const element = createElement("p", { className: "existing-class" });
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      const classes = element.properties?.className as string[];
      assertEquals(Array.isArray(classes), true);
      assertEquals(classes.includes("existing-class"), true);
      assertEquals(classes.includes("mb-4"), true);
    });

    it("preserves existing array className", () => {
      const element = createElement("p", { className: ["existing-class"] });
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      const classes = element.properties?.className as string[];
      assertEquals(classes.includes("existing-class"), true);
      assertEquals(classes.includes("mb-4"), true);
    });

    it("ignores unknown elements", () => {
      const element = createElement("div");
      const tree = createTree(element);

      rehypeAddClasses()(tree);

      assertEquals(element.properties?.className, undefined);
    });

    it("handles nested elements", () => {
      const inner = createElement("code");
      const outer = createElement("p", {}, [inner]);
      const tree = createTree(outer);

      rehypeAddClasses()(tree);

      assertEquals(((outer.properties?.className as string[]) || []).includes("mb-4"), true);
      assertExists(inner.properties?.className);
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
