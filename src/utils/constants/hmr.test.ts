import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isValidHMRMessageType } from "./hmr.ts";

describe("constants/hmr", () => {
  describe("isValidHMRMessageType", () => {
    const validTypes = ["connected", "update", "reload", "ping", "pong"] as const;

    for (const type of validTypes) {
      it(`should return true for '${type}'`, () => {
        assertEquals(isValidHMRMessageType(type), true);
      });
    }

    it("should return false for invalid message type", () => {
      assertEquals(isValidHMRMessageType("invalid"), false);
    });

    it("should return false for empty string", () => {
      assertEquals(isValidHMRMessageType(""), false);
    });

    it("should be case-sensitive", () => {
      assertEquals(isValidHMRMessageType("CONNECTED"), false);
    });
  });
});
