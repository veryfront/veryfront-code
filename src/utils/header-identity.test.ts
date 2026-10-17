import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { decodeIdentityHeaderValue, encodeIdentityHeaderValue } from "./header-identity.ts";

describe("header identity encoding", () => {
  it("preserves raw ByteString branch names", () => {
    assertEquals(encodeIdentityHeaderValue("feature/foo"), "feature/foo");
    assertEquals(decodeIdentityHeaderValue("feature/foo"), "feature/foo");
  });

  it("round-trips unicode branch names through an ASCII header value", () => {
    const encoded = encodeIdentityHeaderValue("功能/新");

    assertEquals(encoded, "vf-utf8:%E5%8A%9F%E8%83%BD%2F%E6%96%B0");
    assertEquals(decodeIdentityHeaderValue(encoded), "功能/新");
  });

  it("encodes raw values that would collide with the encoding prefix", () => {
    const value = "vf-utf8:literal";

    assertEquals(encodeIdentityHeaderValue(value), "vf-utf8:vf-utf8%3Aliteral");
    assertEquals(decodeIdentityHeaderValue(encodeIdentityHeaderValue(value)), value);
  });

  for (const value of ["qa\nblue", "qa\u0000blue", "qa\u0085blue", " 日本語 ", " staging "]) {
    it(`round-trips header-normalized or control values ${JSON.stringify(value)}`, () => {
      const encoded = encodeIdentityHeaderValue(value);
      assertEquals(
        new Headers({ "x-environment-name": encoded }).get("x-environment-name"),
        encoded,
      );
      assertEquals(decodeIdentityHeaderValue(encoded), value);
      assertEquals(encoded.startsWith("vf-utf8:"), true);
    });
  }

  it("treats malformed encoded values as absent", () => {
    assertEquals(decodeIdentityHeaderValue("vf-utf8:%"), undefined);
  });
});
