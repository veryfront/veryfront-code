import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { renderAttributes } from "./html-generator.ts";

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
      const result = renderAttributes({ disabled: true });
      assertEquals(result.trim(), "disabled");
    });

    it("should skip boolean false", () => {
      const result = renderAttributes({ hidden: false });
      assertEquals(result, "");
    });

    it("should skip null and undefined values", () => {
      const result = renderAttributes({ a: null, b: undefined });
      assertEquals(result, "");
    });

    it("should skip children, key, and ref props", () => {
      const result = renderAttributes({
        children: "text",
        key: "k1",
        ref: {},
        id: "test",
      });
      assertEquals(result.includes("children"), false);
      assertEquals(result.includes("key"), false);
      assertEquals(result.includes("ref"), false);
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
  });
});
