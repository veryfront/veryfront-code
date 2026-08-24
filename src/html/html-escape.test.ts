import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildAttributes,
  buildNonceAttribute,
  escapeHTML,
  escapeHtml,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "./html-escape.ts";

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

    it("should reject attribute names that break out of the attribute", () => {
      assertThrows(
        () => buildAttributes({ 'a" onload="x': "1" }),
        TypeError,
        "HTML attribute name is invalid",
        "an injecting attribute name must be rejected, not interpolated raw",
      );
      assertThrows(
        () => buildAttributes({ "data value": "1" }),
        TypeError,
        "HTML attribute name is invalid",
        "an attribute name containing a space must be rejected",
      );
      assertThrows(
        () => buildAttributes({ "data>value": "1" }),
        TypeError,
        "HTML attribute name is invalid",
        "an attribute name containing > must be rejected",
      );
    });

    it("should reject attribute names beyond the name size limit", () => {
      assertThrows(
        () => buildAttributes({ ["a".repeat(257)]: "1" }),
        TypeError,
        "HTML attribute name is invalid",
        "an attribute name over the byte limit must be rejected",
      );
    });

    it("should reject more attributes than the entry limit", () => {
      assertThrows(
        () =>
          buildAttributes(
            Object.fromEntries(
              Array.from({ length: 129 }, (_, index) => [`data-k${index}`, "1"]),
            ),
          ),
        Error,
        "HTML attributes exceed the entry limit",
        "an attribute set over the entry limit must be rejected",
      );
    });

    it("should reject attribute containers that are not plain objects", () => {
      assertThrows(
        () => buildAttributes(["id"] as unknown as Record<string, unknown>),
        Error,
        "HTML attributes must be an object",
        "an array must not be treated as an attribute map",
      );
      class Attrs {
        id = "x";
      }
      assertThrows(
        () => buildAttributes(new Attrs() as unknown as Record<string, unknown>),
        Error,
        "HTML attributes must be a plain object",
        "a class instance must not be treated as an attribute map",
      );
    });

    it("should reject accessor-backed attribute values", () => {
      assertThrows(
        () =>
          buildAttributes(
            Object.defineProperty({}, "id", { get: () => "x", enumerable: true }),
          ),
        Error,
        "HTML attribute value cannot be inspected",
        "a getter-backed attribute value must not be invoked during rendering",
      );
    });
  });

  describe("buildNonceAttribute", () => {
    it("should build an escaped nonce attribute", () => {
      assertEquals(
        buildNonceAttribute('"nonce<value>'),
        ' nonce="&quot;nonce&lt;value&gt;"',
      );
    });

    it("should omit the attribute when nonce is missing", () => {
      assertEquals(buildNonceAttribute(undefined), "");
    });
  });

  describe("raw text element content escaping", () => {
    it("neutralizes closing script tags without escaping ordinary script text", () => {
      assertEquals(
        escapeInlineScriptContent(`globalThis.value="</script><script>alert(1)</script>"`),
        `globalThis.value="<\\/script><script>alert(1)<\\/script>"`,
      );
    });

    it("neutralizes closing style tags without escaping ordinary style text", () => {
      assertEquals(
        escapeInlineStyleContent(`body:after{content:"</style><style>body{color:red}</style>"}`),
        `body:after{content:"<\\/style><style>body{color:red}<\\/style>"}`,
      );
    });
  });
});
