import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildAttributes, escapeHTML, escapeHtml } from "./html-escape.ts";

describe("html-escape", () => {
  describe("escapeHTML", () => {
    it("should escape ampersand", () => {
      assertEquals(escapeHTML("foo & bar"), "foo &amp; bar");
    });

    it("should escape less than", () => {
      assertEquals(escapeHTML("foo < bar"), "foo &lt; bar");
    });

    it("should escape greater than", () => {
      assertEquals(escapeHTML("foo > bar"), "foo &gt; bar");
    });

    it("should escape double quotes", () => {
      assertEquals(escapeHTML('foo "bar"'), "foo &quot;bar&quot;");
    });

    it("should escape single quotes", () => {
      assertEquals(escapeHTML("foo 'bar'"), "foo &#39;bar&#39;");
    });

    it("should escape multiple characters", () => {
      assertEquals(
        escapeHTML('<script>alert("xss")</script>'),
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
      );
    });

    it("should handle empty string", () => {
      assertEquals(escapeHTML(""), "");
    });

    it("should handle null", () => {
      assertEquals(escapeHTML(null as unknown as string), "");
    });

    it("should handle undefined", () => {
      assertEquals(escapeHTML(undefined as unknown as string), "");
    });

    it("should convert non-string values to string", () => {
      assertEquals(escapeHTML(123 as unknown as string), "123");
      assertEquals(escapeHTML(true as unknown as string), "true");
    });

    it("should handle string with no special characters", () => {
      assertEquals(escapeHTML("hello world"), "hello world");
    });
  });

  describe("escapeHtml alias", () => {
    it("should be the same function as escapeHTML", () => {
      assertEquals(escapeHtml, escapeHTML);
    });

    it("should work identically", () => {
      assertEquals(escapeHtml("<div>test</div>"), "&lt;div&gt;test&lt;/div&gt;");
    });
  });

  describe("buildAttributes", () => {
    it("should build single attribute", () => {
      assertEquals(buildAttributes({ id: "test" }), 'id="test"');
    });

    it("should build multiple attributes", () => {
      assertEquals(buildAttributes({ id: "test", class: "foo" }), 'id="test" class="foo"');
    });

    it("should escape attribute values", () => {
      assertEquals(
        buildAttributes({ title: '<script>alert("xss")</script>' }),
        'title="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"',
      );
    });

    it("should handle empty object", () => {
      assertEquals(buildAttributes({}), "");
    });

    it("should convert numeric values to string", () => {
      assertEquals(buildAttributes({ tabindex: "0", value: "42" }), 'tabindex="0" value="42"');
    });

    it("should escape attribute names with special characters in values", () => {
      assertEquals(
        buildAttributes({
          "data-value": "test & value",
          "aria-label": 'Say "Hello"',
        }),
        'data-value="test &amp; value" aria-label="Say &quot;Hello&quot;"',
      );
    });
  });
});
