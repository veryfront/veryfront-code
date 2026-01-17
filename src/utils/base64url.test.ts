import { assertEquals } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { base64urlEncode, base64urlEncodeBytes } from "./base64url.ts";

describe("base64url", () => {
  describe("base64urlEncode", () => {
    it("should encode a simple string", () => {
      const result = base64urlEncode("hello");
      assertEquals(result, "aGVsbG8");
    });

    it("should encode an empty string", () => {
      const result = base64urlEncode("");
      assertEquals(result, "");
    });

    it("should replace + with - and / with _", () => {
      // String that produces + and / in base64
      const input = "test??test";
      const result = base64urlEncode(input);
      assertEquals(result.includes("+"), false);
      assertEquals(result.includes("/"), false);
    });

    it("should remove padding characters", () => {
      // "a" encodes to "YQ==" in base64
      const result = base64urlEncode("a");
      assertEquals(result.includes("="), false);
      assertEquals(result, "YQ");
    });

    it("should handle latin1 characters", () => {
      // btoa only supports Latin1 characters
      const result = base64urlEncode("café");
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should produce consistent output", () => {
      const result1 = base64urlEncode("consistent test");
      const result2 = base64urlEncode("consistent test");
      assertEquals(result1, result2);
    });
  });

  describe("base64urlEncodeBytes", () => {
    it("should encode a Uint8Array", () => {
      const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      const result = base64urlEncodeBytes(bytes);
      assertEquals(result, "aGVsbG8");
    });

    it("should encode an empty Uint8Array", () => {
      const bytes = new Uint8Array([]);
      const result = base64urlEncodeBytes(bytes);
      assertEquals(result, "");
    });

    it("should remove padding from byte encoding", () => {
      const bytes = new Uint8Array([97]); // "a"
      const result = base64urlEncodeBytes(bytes);
      assertEquals(result.includes("="), false);
      assertEquals(result, "YQ");
    });

    it("should handle binary data", () => {
      const bytes = new Uint8Array([0, 255, 128, 64, 32]);
      const result = base64urlEncodeBytes(bytes);
      assertEquals(typeof result, "string");
      assertEquals(result.includes("+"), false);
      assertEquals(result.includes("/"), false);
      assertEquals(result.includes("="), false);
    });

    it("should produce consistent output for same bytes", () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = base64urlEncodeBytes(bytes);
      const result2 = base64urlEncodeBytes(bytes);
      assertEquals(result1, result2);
    });
  });
});
