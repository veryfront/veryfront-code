import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "./base64url.ts";

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

    it("should handle latin1 characters", () => {
      assertEquals(
        base64urlEncode("café"),
        "Y2Fm6Q",
        "latin1 input uses btoa binary-string semantics, not UTF-8 bytes",
      );
    });

    it("should fall back to UTF-8 bytes outside latin1", () => {
      assertEquals(
        base64urlEncode("日本"),
        "5pel5pys",
        "input outside latin1 falls back to UTF-8 bytes",
      );
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

    it("should preserve byte-exact btoa fallback output at chunk and tail boundaries", () => {
      const globalWithBuffer = globalThis as { Buffer?: unknown };
      const bufferDescriptor = Object.getOwnPropertyDescriptor(globalWithBuffer, "Buffer");

      try {
        Object.defineProperty(globalWithBuffer, "Buffer", {
          configurable: true,
          value: undefined,
          writable: true,
        });

        const chunkSize = 24 * 1024;
        for (
          const length of [
            chunkSize - 1,
            chunkSize,
            chunkSize + 1,
            chunkSize + 2,
            300_001,
          ]
        ) {
          const bytes = new Uint8Array(length);
          for (let index = 0; index < bytes.length; index++) {
            bytes[index] = index % 256;
          }

          const encoded = base64urlEncodeBytes(bytes);
          assertEquals(encoded.includes("="), false);

          const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/") +
            "=".repeat((4 - (encoded.length % 4)) % 4);
          const decoded = atob(base64);
          assertEquals(decoded.length, bytes.length);
          for (let index = 0; index < bytes.length; index++) {
            if (decoded.charCodeAt(index) !== bytes[index]) {
              throw new Error(`Round-trip mismatch at byte ${index} for length ${length}`);
            }
          }
        }
      } finally {
        if (bufferDescriptor) {
          Object.defineProperty(globalWithBuffer, "Buffer", bufferDescriptor);
        } else {
          delete globalWithBuffer.Buffer;
        }
      }
    });
  });
});
