import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { getWebSocketMessageSizeBytes } from "./websocket-message-size.ts";

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
});
