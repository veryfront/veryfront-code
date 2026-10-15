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

  it("keeps identity encoding and decoding stable after project intrinsic replacement", () => {
    const trim = String.prototype.trim;
    const charCodeAt = String.prototype.charCodeAt;
    const startsWith = String.prototype.startsWith;
    const slice = String.prototype.slice;
    const encode = globalThis.encodeURIComponent;
    const decode = globalThis.decodeURIComponent;
    let encoded: string | undefined;
    let decoded: string | undefined;
    try {
      String.prototype.trim = () => "poisoned";
      String.prototype.charCodeAt = () => 65;
      String.prototype.startsWith = () => false;
      String.prototype.slice = () => "poisoned";
      globalThis.encodeURIComponent = () => "poisoned";
      globalThis.decodeURIComponent = () => "poisoned";
      encoded = encodeIdentityHeaderValue("日本語\nblue");
      decoded = decodeIdentityHeaderValue("vf-utf8:%E6%97%A5%E6%9C%AC%E8%AA%9E%0Ablue");
    } finally {
      String.prototype.trim = trim;
      String.prototype.charCodeAt = charCodeAt;
      String.prototype.startsWith = startsWith;
      String.prototype.slice = slice;
      globalThis.encodeURIComponent = encode;
      globalThis.decodeURIComponent = decode;
    }
    assertEquals(encoded, "vf-utf8:%E6%97%A5%E6%9C%AC%E8%AA%9E%0Ablue");
    assertEquals(decoded, "日本語\nblue");
  });

  it("treats malformed encoded values as absent", () => {
    assertEquals(decodeIdentityHeaderValue("vf-utf8:%"), undefined);
  });
});
