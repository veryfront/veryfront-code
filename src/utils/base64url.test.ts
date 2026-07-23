import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlDecodeBytes, base64urlEncode, base64urlEncodeBytes } from "./base64url.ts";

describe("base64url", () => {
  describe("base64urlEncode", () => {
    it("should encode a simple string", () => {
      assertEquals(base64urlEncode("hello"), "aGVsbG8");
    });

    it("should encode an empty string", () => {
      assertEquals(base64urlEncode(""), "");
    });

    it("should replace + with - and / with _", () => {
      const result = base64urlEncode("test??test");
      assertEquals(result.includes("+"), false);
      assertEquals(result.includes("/"), false);
    });

    it("should remove padding characters", () => {
      const result = base64urlEncode("a");
      assertEquals(result.includes("="), false);
      assertEquals(result, "YQ");
    });

    it("encodes strings as UTF-8", () => {
      assertEquals(base64urlEncode("café"), "Y2Fmw6k");
      assertEquals(base64urlEncode("你好 👋"), "5L2g5aW9IPCfkYs");
    });

    it("should produce consistent output", () => {
      const input = "consistent test";
      assertEquals(base64urlEncode(input), base64urlEncode(input));
    });
  });

  describe("base64urlEncodeBytes", () => {
    it("should encode a Uint8Array", () => {
      const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      assertEquals(base64urlEncodeBytes(bytes), "aGVsbG8");
    });

    it("should encode an empty Uint8Array", () => {
      assertEquals(base64urlEncodeBytes(new Uint8Array()), "");
    });

    it("should remove padding from byte encoding", () => {
      const result = base64urlEncodeBytes(new Uint8Array([97])); // "a"
      assertEquals(result.includes("="), false);
      assertEquals(result, "YQ");
    });

    it("should handle binary data", () => {
      const result = base64urlEncodeBytes(new Uint8Array([0, 255, 128, 64, 32]));
      assertEquals(typeof result, "string");
      assertEquals(result.includes("+"), false);
      assertEquals(result.includes("/"), false);
      assertEquals(result.includes("="), false);
    });

    it("should produce consistent output for same bytes", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      assertEquals(base64urlEncodeBytes(bytes), base64urlEncodeBytes(bytes));
    });

    it("should encode large byte arrays without overflowing the call stack", () => {
      const bytes = Uint8Array.from(
        { length: 256 * 1024 },
        (_, index) => index % 256,
      );

      const encoded = base64urlEncodeBytes(bytes);
      const padded = encoded.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (encoded.length % 4)) % 4);
      const decoded = atob(padded);

      assertEquals(decoded.length, bytes.length);
      assertEquals(decoded.charCodeAt(0), bytes[0]);
      assertEquals(decoded.charCodeAt(131_071), bytes[131_071]);
      assertEquals(decoded.charCodeAt(bytes.length - 1), bytes[bytes.length - 1]);
    });
  });

  describe("base64urlDecodeBytes", () => {
    it("roundtrips arbitrary binary bytes without interpreting them as text", () => {
      const bytes = new Uint8Array([0, 255, 128, 64, 32]);
      assertEquals(base64urlDecodeBytes(base64urlEncodeBytes(bytes)), bytes);
    });

    it("rejects malformed base64url input", () => {
      assertEquals(base64urlDecodeBytes("a"), undefined);
      assertEquals(base64urlDecodeBytes("not+base64"), undefined);
      assertEquals(base64urlDecodeBytes("Zh"), undefined);
    });
  });
});
