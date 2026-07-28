import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getReactDOMServer } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import type { RSCNode } from "../types.ts";
import { renderAttributes, treeToHTML } from "./html-generator.ts";

// React 19 owns one process-lifetime scheduler MessagePort. Create it during
// module setup so per-test sanitizers still detect resources owned by each test.
await getReactDOMServer();

describe("rendering/rsc/server-renderer/html-generator", () => {
  describe("renderAttributes", () => {
    it("should return empty string for empty props", () => {
      assertEquals(renderAttributes({}), "");
    });

    it("should render string attributes", () => {
      const result = renderAttributes({ id: "main", title: "Hello" });
      assertEquals(result.includes('id="main"'), true);
      assertEquals(result.includes('title="Hello"'), true);
    });

    it("should convert className to class", () => {
      const result = renderAttributes({ className: "container" });
      assertEquals(result.includes('class="container"'), true);
      assertEquals(result.includes("className"), false);
    });

    it("converts React's htmlFor prop to the HTML for attribute", () => {
      assertEquals(renderAttributes({ htmlFor: "field" }), ' for="field"');
    });

    it("should render boolean true as attribute name only", () => {
      assertEquals(renderAttributes({ disabled: true }).trim(), "disabled");
    });

    it("should skip boolean false", () => {
      assertEquals(renderAttributes({ hidden: false }), "");
    });

    it("should skip null and undefined values", () => {
      assertEquals(renderAttributes({ a: null, b: undefined }), "");
    });

    it("should skip children, key, and ref props", () => {
      const result = renderAttributes({
        children: "text",
        key: "k1",
        ref: {},
        id: "test",
      });

      for (const prop of ["children", "key", "ref"]) {
        assertEquals(result.includes(prop), false);
      }
      assertEquals(result.includes("id"), true);
    });

    it("should escape HTML in attribute values", () => {
      const result = renderAttributes({ title: '<script>alert("xss")</script>' });
      assertEquals(result.includes("<script>"), false);
    });

    it("should render number attributes as strings", () => {
      const result = renderAttributes({ tabIndex: 0 });
      assertEquals(result.includes('tabIndex="0"'), true);
    });

    it("omits unsafe and event-handler names before interpolating attributes", () => {
      const result = renderAttributes({
        'x" http-equiv="refresh" content': "0;url=https://example.invalid",
        onClick: "alert(1)",
        ONLOAD: "alert(1)",
        className: "safe",
        htmlFor: "field",
        "aria-label": "Field",
        "data-test-id": "field",
      });

      assertEquals(result.includes("http-equiv"), false);
      assertEquals(result.toLowerCase().includes("onclick"), false);
      assertEquals(result.toLowerCase().includes("onload"), false);
      assertEquals(result.includes('class="safe"'), true);
      assertEquals(result.includes('for="field"'), true);
      assertEquals(result.includes('aria-label="Field"'), true);
      assertEquals(result.includes('data-test-id="field"'), true);
    });

    it("does not invoke accessors or custom primitive coercion", () => {
      let getterCalls = 0;
      let coercionCalls = 0;
      const props = Object.create({
        get inherited() {
          getterCalls++;
          return "inherited";
        },
      }) as Record<string, unknown>;
      Object.defineProperty(props, "accessor", {
        enumerable: true,
        get() {
          getterCalls++;
          return "accessor";
        },
      });
      props.safe = "value";
      props.object = {
        toString() {
          coercionCalls++;
          return "coerced";
        },
      };

      assertEquals(renderAttributes(props), ' safe="value"');
      assertEquals(getterCalls, 0);
      assertEquals(coercionCalls, 0);
    });
  });

  describe("treeToHTML", () => {
    it("uses React's host markup semantics for aliases, styles, and void elements", async () => {
      assertEquals(
        await treeToHTML({
          type: "server",
          component: "label",
          props: {
            className: "field",
            htmlFor: "name",
            style: { color: "red" },
          },
          children: [{ type: "html", text: "Name" }],
        }),
        '<label class="field" for="name" style="color:red">Name</label>',
      );
      assertEquals(
        await treeToHTML({
          type: "server",
          component: "input",
          props: { disabled: true, name: "name" },
        }),
        '<input disabled="" name="name"/>',
      );
    });

    it("rejects trees deeper than the rendering budget", async () => {
      let node: RSCNode = { type: "html", text: "leaf" };
      for (let depth = 0; depth < 65; depth++) {
        node = { type: "fragment", children: [node] };
      }

      await assertRejects(
        () => treeToHTML(node),
        RangeError,
        "depth limit",
      );
    });

    it("rejects trees larger than the rendering budget", async () => {
      const children = Array.from(
        { length: 10_001 },
        (): RSCNode => ({ type: "html", text: "x" }),
      );

      await assertRejects(
        () => treeToHTML({ type: "fragment", children }),
        RangeError,
        "node limit",
      );
    });
  });
});
