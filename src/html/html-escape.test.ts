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

    it("rejects escape inputs that can exceed the HTML output budget", () => {
      assertThrows(
        () => escapeHTML('"'.repeat(2 * 1024 * 1024 + 1)),
        Error,
        "size limit",
      );
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

    it("rejects malformed attribute names", () => {
      for (const name of ['title" onclick', "x onmouseover", "<script", "data-value="]) {
        assertThrows(
          () => buildAttributes({ [name]: "value" }),
          TypeError,
          "attribute name",
        );
      }
    });

    it("rejects excessive attribute collections", () => {
      const attributes = Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [`data-value-${index}`, "value"]),
      );

      assertThrows(
        () => buildAttributes(attributes),
        Error,
        "entry limit",
      );
    });

    it("rejects oversized attribute values", () => {
      assertThrows(
        () => buildAttributes({ title: "x".repeat(64 * 1024 + 1) }),
        Error,
        "size limit",
      );
    });

    it("converts inaccessible attribute collections into validation failures", () => {
      const attributes = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });

      assertThrows(
        () => buildAttributes(attributes),
        Error,
        "attributes cannot be inspected",
      );
    });

    it("converts inaccessible attribute values into validation failures", () => {
      const attributes = {} as Record<string, string>;
      Object.defineProperty(attributes, "title", {
        enumerable: true,
        get() {
          throw new Error("private implementation detail");
        },
      });

      assertThrows(
        () => buildAttributes(attributes),
        Error,
        "attribute value cannot be inspected",
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

    it("rejects oversized nonces", () => {
      assertThrows(
        () => buildNonceAttribute("n".repeat(4097)),
        Error,
        "nonce",
      );
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
