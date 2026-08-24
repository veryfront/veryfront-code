import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeData as sanitizeDataFromRoot } from "../../index.ts";
import { sanitizeData as sanitizeDataFromClient } from "../../index.client.ts";
import { sanitizeData as sanitizeDataFromSecurity } from "../index.ts";
import { sanitizeData } from "./sanitizers.ts";

describe("sanitizeData compatibility", () => {
  it("is the same compatibility function through root, client, and security exports", () => {
    assertEquals(sanitizeDataFromRoot, sanitizeData);
    assertEquals(sanitizeDataFromClient, sanitizeData);
    assertEquals(sanitizeDataFromSecurity, sanitizeData);
  });

  it("HTML-encodes nested string values", () => {
    assertEquals(sanitizeData({ values: ["<b>&</b>"] }), {
      values: ["&lt;b&gt;&amp;&lt;&#x2F;b&gt;"],
    });
  });

  it("HTML-encodes quotes that would break out of an attribute", () => {
    assertEquals(
      sanitizeData({ v: `<a href="x" onclick='y'>` }),
      { v: "&lt;a href=&quot;x&quot; onclick=&#x27;y&#x27;&gt;" },
      "double and single quotes must be encoded so sanitized values cannot break out of an HTML attribute",
    );
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
