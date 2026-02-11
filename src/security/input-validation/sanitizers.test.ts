/**
 * Sanitizers Tests
 *
 * Tests for XSS and prototype pollution prevention
 */

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { sanitizeData } from "./sanitizers.ts";

describe("sanitizeData", () => {
  describe("string sanitization", () => {
    it("should escape HTML entities", () => {
      assertEquals(
        sanitizeData("<script>alert('xss')</script>"),
        "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;&#x2F;script&gt;",
      );
    });

    it("should escape ampersands", () => {
      assertEquals(sanitizeData("foo & bar"), "foo &amp; bar");
    });

    it("should escape double quotes", () => {
      assertEquals(sanitizeData('hello "world"'), "hello &quot;world&quot;");
    });

    it("should escape single quotes", () => {
      assertEquals(sanitizeData("hello 'world'"), "hello &#x27;world&#x27;");
    });

    it("should escape forward slashes", () => {
      assertEquals(sanitizeData("path/to/file"), "path&#x2F;to&#x2F;file");
    });

    it("should escape angle brackets", () => {
      assertEquals(sanitizeData("1 < 2 > 0"), "1 &lt; 2 &gt; 0");
    });

    it("should handle empty strings", () => {
      assertEquals(sanitizeData(""), "");
    });

    it("should handle strings without special characters", () => {
      assertEquals(sanitizeData("hello world"), "hello world");
    });
  });

  describe("array sanitization", () => {
    it("should sanitize all array elements", () => {
      assertEquals(sanitizeData(["<b>", "<i>"]), ["&lt;b&gt;", "&lt;i&gt;"]);
    });

    it("should handle nested arrays", () => {
      assertEquals(sanitizeData([["<a>"], ["<b>"]]), [
        ["&lt;a&gt;"],
        ["&lt;b&gt;"],
      ]);
    });

    it("should handle empty arrays", () => {
      assertEquals(sanitizeData([]), []);
    });

    it("should handle mixed type arrays", () => {
      assertEquals(sanitizeData(["<script>", 123, true, null]), [
        "&lt;script&gt;",
        123,
        true,
        null,
      ]);
    });
  });

  describe("object sanitization", () => {
    it("should sanitize object values", () => {
      assertEquals(sanitizeData({ name: "<script>" }), {
        name: "&lt;script&gt;",
      });
    });

    it("should sanitize nested objects", () => {
      assertEquals(
        sanitizeData({
          outer: { inner: "<b>test</b>" },
        }),
        {
          outer: { inner: "&lt;b&gt;test&lt;&#x2F;b&gt;" },
        },
      );
    });

    it("should handle empty objects", () => {
      assertEquals(sanitizeData({}), {});
    });

    it("should handle objects with arrays", () => {
      assertEquals(
        sanitizeData({
          items: ["<a>", "<b>"],
        }),
        {
          items: ["&lt;a&gt;", "&lt;b&gt;"],
        },
      );
    });
  });

  describe("prototype pollution prevention", () => {
    it("should remove __proto__ keys", () => {
      const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
      const result = sanitizeData(malicious) as Record<string, unknown>;

      // Check __proto__ is not an own property (not that it's undefined - .__proto__ is always the prototype)
      assertEquals(Object.hasOwn(result, "__proto__"), false);
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
      assertEquals(Object.hasOwn(result, "prototype"), false);
    });

    it("should sanitize keys to alphanumeric, dots, underscores, hyphens", () => {
      const result = sanitizeData({
        normal_key: "value1",
        "key.with.dots": "value2",
        "key-with-hyphens": "value3",
        "key$with%special": "value4",
      }) as Record<string, unknown>;

      assertEquals(result.normal_key, "value1");
      assertEquals(result["key.with.dots"], "value2");
      assertEquals(result["key-with-hyphens"], "value3");
      assertEquals(result.keywithspecial, "value4");
    });

    it("should block uppercase __PROTO__ keys", () => {
      const malicious = { __PROTO__: { polluted: true } };
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(Object.hasOwn(result, "__PROTO__"), false);
    });

    it("should block uppercase CONSTRUCTOR keys", () => {
      const malicious = { CONSTRUCTOR: { value: "bad" } };
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(Object.hasOwn(result, "CONSTRUCTOR"), false);
    });

    it("should block keys containing __proto__ as substring", () => {
      const malicious = {
        __proto__polluted: "bad",
        x__proto__: "bad",
        foo__proto__bar: "bad",
      };
      const result = sanitizeData(malicious) as Record<string, unknown>;

      assertEquals(Object.hasOwn(result, "__proto__polluted"), false);
      assertEquals(Object.hasOwn(result, "x__proto__"), false);
      assertEquals(Object.hasOwn(result, "foo__proto__bar"), false);
    });

    it("should block keys containing constructor as substring", () => {
      const malicious = {
        constructorPolluted: "bad",
        myConstructor: "bad",
      };
      const result = sanitizeData(malicious) as Record<string, unknown>;

      assertEquals(Object.hasOwn(result, "constructorPolluted"), false);
      assertEquals(Object.hasOwn(result, "myConstructor"), false);
    });

    it("should block keys containing prototype as substring", () => {
      const malicious = {
        prototypeChain: "bad",
        myPrototype: "bad",
      };
      const result = sanitizeData(malicious) as Record<string, unknown>;

      assertEquals(Object.hasOwn(result, "prototypeChain"), false);
      assertEquals(Object.hasOwn(result, "myPrototype"), false);
    });

    it("should block mixed case variations", () => {
      const malicious = {
        __PrOtO__: { polluted: true },
        ConsTRUCtor: { value: "bad" },
        PROTOtype: { value: "bad" },
      };
      const result = sanitizeData(malicious) as Record<string, unknown>;
      assertEquals(Object.keys(result).length, 0);
    });

    it("should block Unicode homoglyph bypass attempts", () => {
      // U+017F (long s) normalizes to 's' under NFKC, so "con\u017Ftructor"
      // becomes "constructor" after normalize('NFKC').toLowerCase()
      // Note: sanitizeKey strips non-word chars, but NFKC normalization
      // converts these to ASCII equivalents before the strip.
      const result1 = sanitizeData({
        "con\u017Ftructor": { value: "bad" },
      }) as Record<string, unknown>;
      assertEquals(Object.keys(result1).length, 0);

      // U+FF50 (fullwidth 'p') normalizes to 'p' under NFKC
      const result2 = sanitizeData({
        "\uFF50rototype": { value: "bad" },
      }) as Record<string, unknown>;
      assertEquals(Object.keys(result2).length, 0);
    });

    it("should produce null-prototype objects to prevent prototype chain attacks", () => {
      const result = sanitizeData({ safe: "value" }) as Record<string, unknown>;
      assertEquals(Object.getPrototypeOf(result), null);
    });

    it("should produce null-prototype objects in nested structures", () => {
      const result = sanitizeData({
        outer: { inner: "value" },
      }) as Record<string, unknown>;
      assertEquals(Object.getPrototypeOf(result), null);
      assertEquals(
        Object.getPrototypeOf(result.outer as Record<string, unknown>),
        null,
      );
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

      assertEquals(sanitizeData(input), {
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
        items: [{ name: "<a>" }, { name: "<b>" }],
      };

      assertEquals(sanitizeData(input), {
        items: [{ name: "&lt;a&gt;" }, { name: "&lt;b&gt;" }],
      });
    });
  });
});
