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

  it("treats malformed encoded values as absent", () => {
    assertEquals(decodeIdentityHeaderValue("vf-utf8:%"), undefined);
  });
});
