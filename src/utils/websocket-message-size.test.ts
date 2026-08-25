import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getWebSocketMessageAdmission,
  getWebSocketMessageSizeBytes,
} from "#veryfront/utils/websocket-message-size.ts";

describe("websocket-message-size", () => {
  describe("getWebSocketMessageSizeBytes", () => {
    it("should measure strings as UTF-8 bytes", () => {
      assertEquals(getWebSocketMessageSizeBytes("abc"), 3);
      assertEquals(getWebSocketMessageSizeBytes("é"), 2);
      assertEquals(getWebSocketMessageSizeBytes("😀"), 4);
    });

    it("should measure ArrayBuffer payloads by byteLength", () => {
      assertEquals(getWebSocketMessageSizeBytes(new ArrayBuffer(16)), 16);
    });

    it("should measure ArrayBuffer views by their visible slice", () => {
      const buffer = new ArrayBuffer(32);
      assertEquals(getWebSocketMessageSizeBytes(new Uint8Array(buffer, 8, 4)), 4);
    });

    it("should count a Blob message at its real byte size", () => {
      assertEquals(getWebSocketMessageSizeBytes(new Blob([new Uint8Array(64)])), 64);
      assertEquals(getWebSocketMessageSizeBytes(new Blob(["😀"])), 4);
    });

    it("should return 0 for unknown payload types", () => {
      assertEquals(getWebSocketMessageSizeBytes(null), 0);
      assertEquals(getWebSocketMessageSizeBytes(undefined), 0);
      assertEquals(getWebSocketMessageSizeBytes(123), 0);
    });
  });

  describe("getWebSocketMessageAdmission", () => {
    it("accepts exact UTF-8 boundaries and rejects one byte beyond them", () => {
      assertEquals(getWebSocketMessageAdmission("éé", 4), {
        accepted: true,
        sizeBytes: 4,
      });
      assertEquals(getWebSocketMessageAdmission("ééa", 4), {
        accepted: false,
        sizeBytes: 5,
      });
    });

    it("rejects obviously oversized strings without exact full-string sizing", () => {
      const admission = getWebSocketMessageAdmission("x".repeat(1_000_000), 8);
      assertEquals(admission, {
        accepted: false,
        sizeBytes: 9,
      });
      assertEquals(JSON.parse(JSON.stringify(admission)), {
        accepted: false,
        sizeBytes: 9,
      });
    });

    it("admits fixed-size payloads without materializing their contents", () => {
      assertEquals(getWebSocketMessageAdmission(new Blob([new Uint8Array(8)]), 8), {
        accepted: true,
        sizeBytes: 8,
      });
      assertEquals(getWebSocketMessageAdmission(new Uint8Array(9), 8), {
        accepted: false,
        sizeBytes: 9,
      });
    });

    it("validates the admission boundary", () => {
      const invalidLimits = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
        -1,
      ];

      for (const invalid of invalidLimits) {
        assertThrows(
          () => getWebSocketMessageAdmission("value", invalid),
          RangeError,
          "maximumBytes",
          `a limit of ${invalid} must fail loudly instead of silently changing the cap`,
        );
      }

      assertEquals(
        getWebSocketMessageAdmission("x".repeat(16), Number.MAX_SAFE_INTEGER),
        { accepted: true, sizeBytes: 16 },
        "a MAX_SAFE_INTEGER limit must still admit ordinary payloads",
      );
    });
  });
});
