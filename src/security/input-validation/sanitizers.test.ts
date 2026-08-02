import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeData } from "./sanitizers.ts";

describe("sanitizeData compatibility", () => {
  it("HTML-encodes nested string values", () => {
    assertEquals(sanitizeData({ values: ["<b>&</b>"] }), {
      values: ["&lt;b&gt;&amp;&lt;&#x2F;b&gt;"],
    });
  });

  it("uses null-prototype objects and rejects prototype-chain keys", () => {
    const value = sanitizeData(
      JSON.parse('{"safe":"ok","__proto__":{"polluted":true},"constructor":"bad"}'),
    ) as Record<string, unknown>;
    assertEquals(Object.getPrototypeOf(value), null);
    assertEquals(Object.keys(value), ["safe"]);
    assertEquals(value.safe, "ok");
  });

  it("normalizes Unicode before rejecting dangerous key homoglyphs", () => {
    const value = sanitizeData({ "con\u017Ftructor": "bad", "\uFF50rototype": "bad" }) as Record<
      string,
      unknown
    >;
    assertEquals(Object.keys(value), []);
  });
});
