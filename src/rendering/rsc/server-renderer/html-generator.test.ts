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
      assertEquals(
        renderAttributes({ title: '<script>alert("xss")</script>' }),
        ' title="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"',
        "attribute values escape quotes, not just angle brackets",
      );
      assertEquals(
        renderAttributes({ title: "it's & <b>" }),
        ' title="it&#39;s &amp; &lt;b&gt;"',
        "single quotes and ampersands are escaped exactly once",
      );
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
        constructor: "safe-constructor",
        "aria-label": "Field",
        "data-test-id": "field",
      });

      assertEquals(result.includes("http-equiv"), false);
      assertEquals(result.toLowerCase().includes("onclick"), false);
      assertEquals(result.toLowerCase().includes("onload"), false);
      assertEquals(result.includes('class="safe"'), true);
      assertEquals(result.includes('constructor="safe-constructor"'), true);
      assertEquals(
        result.includes('for="field"'),
        true,
        "htmlFor is emitted as the HTML for attribute",
      );
      assertEquals(result.includes("htmlFor"), false, "the React prop name is not emitted");
      assertEquals(result.includes('aria-label="Field"'), true);
      assertEquals(result.includes('data-test-id="field"'), true);
    });
  });

  describe("treeToHTML", () => {
    it("preserves htmlFor on custom elements while mapping label htmlFor to for", async () => {
      const html = await treeToHTML({
        type: "fragment",
        children: [
          {
            type: "server",
            component: "label",
            props: { htmlFor: "standard-field" },
            children: [{ type: "html", text: "Standard" }],
          },
          {
            type: "server",
            component: "design-label",
            props: { htmlFor: "custom-field" },
            children: [{
              type: "client",
              component: "ClientBoundary",
              props: { id: "custom-field" },
            }],
          },
        ],
      });

      assertEquals(
        html.includes('<label for="standard-field">Standard</label>'),
        true,
        "standard labels use the HTML for attribute",
      );
      assertEquals(
        html.includes('<design-label htmlFor="custom-field">'),
        true,
        "custom elements preserve React-style htmlFor",
      );
      assertEquals(
        html.includes('<design-label for="custom-field">'),
        false,
        "custom elements do not receive normalized for attributes",
      );
    });

    it("maps htmlFor on customized built-ins declared via the is prop", async () => {
      const html = await treeToHTML({
        type: "server",
        component: "label",
        props: { is: "design-label", htmlFor: "target" },
        children: [{
          type: "client",
          component: "ClientBoundary",
          props: { id: "target" },
        }],
      });

      assertEquals(
        html.includes('is="design-label"'),
        true,
        "the is attribute is emitted",
      );
      assertEquals(
        html.includes('for="target"'),
        true,
        "customized built-ins use the standard for attribute",
      );
      assertEquals(
        html.includes('htmlFor="target"'),
        false,
        "customized built-ins do not use the custom-element attribute path",
      );
    });

    it("maps htmlFor on reserved hyphenated SVG and MathML elements", async () => {
      for (
        const component of [
          "annotation-xml",
          "color-profile",
          "font-face",
          "font-face-format",
          "font-face-name",
          "font-face-src",
          "font-face-uri",
          "missing-glyph",
        ]
      ) {
        const html = await treeToHTML({
          type: "server",
          component,
          props: { htmlFor: "target" },
        });
        assertEquals(
          html.includes('for="target"'),
          true,
          `${component} uses the standard for attribute`,
        );
        assertEquals(
          html.includes('htmlFor="target"'),
          false,
          `${component} does not keep the React prop name`,
        );
      }
    });
  });
});
