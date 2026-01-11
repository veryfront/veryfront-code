/**
 * Sanitizers Tests
 *
 * Tests for XSS and prototype pollution prevention
 */

import { describe, it } from "jsr:@std/testing@1/bdd";
import { assertEquals } from "jsr:@std/assert@1";
import { sanitizeData } from "./sanitizers.ts";

describe("sanitizeData", () => {
  describe("string sanitization", () => {
    it("should escape HTML entities", () => {
      const result = sanitizeData("<script>alert('xss')</script>");
      assertEquals(
        result,
        "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;&#x2F;script&gt;",
      );
    });

    it("should escape ampersands", () => {
      const result = sanitizeData("foo & bar");
      assertEquals(result, "foo &amp; bar");
    });

    it("should escape double quotes", () => {
      const result = sanitizeData('hello "world"');
      assertEquals(result, "hello &quot;world&quot;");
    });

    it("should escape single quotes", () => {
      const result = sanitizeData("hello 'world'");
      assertEquals(result, "hello &#x27;world&#x27;");
    });

    it("should escape forward slashes", () => {
      const result = sanitizeData("path/to/file");
      assertEquals(result, "path&#x2F;to&#x2F;file");
    });

    it("should escape angle brackets", () => {
      const result = sanitizeData("1 < 2 > 0");
      assertEquals(result, "1 &lt; 2 &gt; 0");
    });

    it("should handle empty strings", () => {
      const result = sanitizeData("");
      assertEquals(result, "");
    });

    it("should handle strings without special characters", () => {
      const result = sanitizeData("hello world");
      assertEquals(result, "hello world");
    });
  });

  describe("array sanitization", () => {
    it("should sanitize all array elements", () => {
      const result = sanitizeData(["<b>", "<i>"]);
      assertEquals(result, ["&lt;b&gt;", "&lt;i&gt;"]);
    });

    it("should handle nested arrays", () => {
      const result = sanitizeData([["<a>"], ["<b>"]]);
      assertEquals(result, [["&lt;a&gt;"], ["&lt;b&gt;"]]);
    });

    it("should handle empty arrays", () => {
      const result = sanitizeData([]);
      assertEquals(result, []);
    });

    it("should handle mixed type arrays", () => {
      const result = sanitizeData(["<script>", 123, true, null]);
      assertEquals(result, ["&lt;script&gt;", 123, true, null]);
    });
  });

  describe("object sanitization", () => {
    it("should sanitize object values", () => {
      const result = sanitizeData({ name: "<script>" });
      assertEquals(result, { name: "&lt;script&gt;" });
    });

    it("should sanitize nested objects", () => {
      const result = sanitizeData({
        outer: { inner: "<b>test</b>" },
      });
      assertEquals(result, {
        outer: { inner: "&lt;b&gt;test&lt;&#x2F;b&gt;" },
      });
    });

    it("should handle empty objects", () => {
      const result = sanitizeData({});
      assertEquals(result, {});
    });

    it("should handle objects with arrays", () => {
      const result = sanitizeData({
        items: ["<a>", "<b>"],
      });
      assertEquals(result, {
        items: ["&lt;a&gt;", "&lt;b&gt;"],
      });
    });
  });

  describe("prototype pollution prevention", () => {
    it("should remove __proto__ keys", () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(result.__proto__, undefined);
      assertEquals("polluted" in result, false);
    });

    it("should remove constructor keys", () => {
      const malicious = { constructor: { value: "bad" } };
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(Object.hasOwn(result, "constructor"), false);
    });

    it("should remove prototype keys", () => {
      const malicious = { prototype: { value: "bad" } };
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(result.prototype, undefined);
    });

    it("should sanitize keys to alphanumeric, dots, underscores, hyphens", () => {
      const result = sanitizeData({
        "normal_key": "value1",
        "key.with.dots": "value2",
        "key-with-hyphens": "value3",
        "key$with%special": "value4",
      }) as Record<string, unknown>;
      assertEquals(result["normal_key"], "value1");
      assertEquals(result["key.with.dots"], "value2");
      assertEquals(result["key-with-hyphens"], "value3");
      assertEquals(result["keywithspecial"], "value4");
    });
  });

  describe("primitive passthrough", () => {
    it("should pass through numbers unchanged", () => {
      assertEquals(sanitizeData(42), 42);
      assertEquals(sanitizeData(3.14), 3.14);
      assertEquals(sanitizeData(-1), -1);
    });

    it("should pass through booleans unchanged", () => {
      assertEquals(sanitizeData(true), true);
      assertEquals(sanitizeData(false), false);
    });

    it("should pass through null unchanged", () => {
      assertEquals(sanitizeData(null), null);
    });

    it("should pass through undefined unchanged", () => {
      assertEquals(sanitizeData(undefined), undefined);
    });
  });

  describe("complex nested structures", () => {
    it("should handle deeply nested structures", () => {
      const input = {
        level1: {
          level2: {
            level3: {
              value: "<script>",
            },
          },
        },
      };
      const result = sanitizeData(input);
      assertEquals(result, {
        level1: {
          level2: {
            level3: {
              value: "&lt;script&gt;",
            },
          },
        },
      });
    });

    it("should handle mixed arrays and objects", () => {
      const input = {
        items: [
          { name: "<a>" },
          { name: "<b>" },
        ],
      };
      const result = sanitizeData(input);
      assertEquals(result, {
        items: [
          { name: "&lt;a&gt;" },
          { name: "&lt;b&gt;" },
        ],
      });
    });
  });
});
