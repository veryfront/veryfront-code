import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import { escapeHTML, buildAttributes } from "./html-escape.ts";

describe("html-escape", () => {
  describe("escapeHTML", () => {
    it("should return empty string for null", () => {
      assertEquals(escapeHTML(null as any), "");
    });

    it("should return empty string for undefined", () => {
      assertEquals(escapeHTML(undefined as any), "");
    });

    it("should escape ampersand", () => {
      assertEquals(escapeHTML("Tom & Jerry"), "Tom &amp; Jerry");
    });

    it("should escape less than", () => {
      assertEquals(escapeHTML("5 < 10"), "5 &lt; 10");
    });

    it("should escape greater than", () => {
      assertEquals(escapeHTML("10 > 5"), "10 &gt; 5");
    });

    it("should escape double quotes", () => {
      assertEquals(escapeHTML('Say "hello"'), "Say &quot;hello&quot;");
    });

    it("should escape single quotes", () => {
      assertEquals(escapeHTML("It's nice"), "It&#39;s nice");
    });

    it("should escape all special characters together", () => {
      const input = `<script>alert("Tom & Jerry's show")</script>`;
      const expected = `&lt;script&gt;alert(&quot;Tom &amp; Jerry&#39;s show&quot;)&lt;/script&gt;`;
      assertEquals(escapeHTML(input), expected);
    });

    it("should handle empty string", () => {
      assertEquals(escapeHTML(""), "");
    });

    it("should handle string without special characters", () => {
      assertEquals(escapeHTML("Hello World"), "Hello World");
    });

    it("should escape HTML injection attempt", () => {
      const injection = '<img src=x onerror="alert(1)">';
      const expected = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
      assertEquals(escapeHTML(injection), expected);
    });

    it("should convert numbers to string and escape", () => {
      assertEquals(escapeHTML(123 as any), "123");
    });

    it("should convert boolean to string and escape", () => {
      assertEquals(escapeHTML(true as any), "true");
      assertEquals(escapeHTML(false as any), "false");
    });

    it("should handle multiple consecutive special characters", () => {
      assertEquals(escapeHTML("&&&"), "&amp;&amp;&amp;");
      assertEquals(escapeHTML("<<<"), "&lt;&lt;&lt;");
    });

    it("should preserve whitespace", () => {
      assertEquals(escapeHTML("  space  test  "), "  space  test  ");
    });

    it("should preserve newlines", () => {
      assertEquals(escapeHTML("line1\nline2\nline3"), "line1\nline2\nline3");
    });
  });

  describe("buildAttributes", () => {
    it("should build attributes from object", () => {
      const attrs = { id: "test", class: "container" };
      const result = buildAttributes(attrs);
      assertEquals(result, 'id="test" class="container"');
    });

    it("should escape attribute values", () => {
      const attrs = { title: 'Say "hello"', onclick: "alert('test')" };
      const result = buildAttributes(attrs);
      assertEquals(result, 'title="Say &quot;hello&quot;" onclick="alert(&#39;test&#39;)"');
    });

    it("should handle empty object", () => {
      const attrs = {};
      const result = buildAttributes(attrs);
      assertEquals(result, "");
    });

    it("should handle single attribute", () => {
      const attrs = { href: "/home" };
      const result = buildAttributes(attrs);
      assertEquals(result, 'href="/home"');
    });

    it("should escape dangerous HTML in attributes", () => {
      const attrs = {
        data: '<script>alert("xss")</script>',
        value: 'Tom & Jerry'
      };
      const result = buildAttributes(attrs);
      assertEquals(
        result,
        'data="&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;" value="Tom &amp; Jerry"'
      );
    });

    it("should convert non-string values to strings", () => {
      const attrs = {
        count: "123",
        enabled: "true"
      };
      const result = buildAttributes(attrs);
      assertEquals(result, 'count="123" enabled="true"');
    });

    it("should handle attributes with special characters in keys", () => {
      const attrs = {
        "data-value": "test",
        "aria-label": "button"
      };
      const result = buildAttributes(attrs);
      assertEquals(result, 'data-value="test" aria-label="button"');
    });

    it("should handle empty string values", () => {
      const attrs = {
        id: "",
        class: "test"
      };
      const result = buildAttributes(attrs);
      assertEquals(result, 'id="" class="test"');
    });

    it("should handle multiple attributes with special characters", () => {
      const attrs = {
        id: "test<>",
        title: '"quoted"',
        data: "a&b"
      };
      const result = buildAttributes(attrs);
      assertEquals(
        result,
        'id="test&lt;&gt;" title="&quot;quoted&quot;" data="a&amp;b"'
      );
    });
  });
});
