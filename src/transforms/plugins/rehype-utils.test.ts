import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rehypeMdxComponents } from "./rehype-utils.ts";

describe("rehype-utils", () => {
  describe("rehypeMdxComponents", () => {
    it("adds data attribute to MDX component", () => {
      const mdxComponent = { type: "mdxJsxFlowElement", name: "Button" };
      const tree = { type: "root", children: [mdxComponent] };

      rehypeMdxComponents()(tree);

      assertExists((mdxComponent as any).data);
      assertExists((mdxComponent as any).data.hProperties);
      assertEquals(
        (mdxComponent as any).data.hProperties["data-mdx-component"],
        "Button",
      );
    });

    it("handles multiple components", () => {
      const mdxComponent1 = { type: "mdxJsxFlowElement", name: "Button" };
      const mdxComponent2 = { type: "mdxJsxFlowElement", name: "Card" };
      const tree = { type: "root", children: [mdxComponent1, mdxComponent2] };

      rehypeMdxComponents()(tree);

      assertEquals(
        (mdxComponent1 as any).data.hProperties["data-mdx-component"],
        "Button",
      );
      assertEquals(
        (mdxComponent2 as any).data.hProperties["data-mdx-component"],
        "Card",
      );
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
      assertEquals(
        (mdxComponent as any).data.hProperties["data-mdx-component"],
        "Button",
      );
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
      assertEquals(
        (mdxComponent as any).data.hProperties["data-mdx-component"],
        "Button",
      );
    });
  });
});
