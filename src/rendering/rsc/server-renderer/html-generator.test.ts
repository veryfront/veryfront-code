import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { renderAttributes, treeToHTML } from "./html-generator.ts";

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
      assertEquals(result.includes('htmlFor="field"'), true);
      assertEquals(result.includes('aria-label="Field"'), true);
      assertEquals(result.includes('data-test-id="field"'), true);
    });

    it("does not stringify executable or structured values into attributes", () => {
      const result = renderAttributes({
        dangerouslySetInnerHTML: { __html: "<script>alert(1)</script>" },
        payload: { secret: true },
        callback: () => undefined,
        marker: Symbol("marker"),
        id: "safe",
      });

      assertEquals(result, ' id="safe"');
    });
  });

  describe("treeToHTML", () => {
    it("generates deterministic boundary identifiers", async () => {
      const node = {
        type: "client" as const,
        component: "Button",
        props: { label: "Save" },
      };

      assertEquals(await treeToHTML(node), await treeToHTML(node));
    });

    it("assigns distinct deterministic identifiers to sibling boundaries", async () => {
      const html = await treeToHTML({
        type: "fragment",
        children: [
          { type: "client", component: "Button" },
          { type: "client", component: "Button" },
        ],
      });
      const ids = [...html.matchAll(/data-rsc-id="([^"]+)"/g)].map((match) => match[1]);

      assertEquals(ids.length, 2);
      assertEquals(ids[0] !== ids[1], true);
    });
  });
});
