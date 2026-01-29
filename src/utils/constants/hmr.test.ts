import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isValidHMRMessageType } from "./hmr.ts";

describe("constants/hmr", () => {
  describe("isValidHMRMessageType", () => {
    it("should return true for 'connected'", () => {
      assertEquals(isValidHMRMessageType("connected"), true);
    });

    it("should return true for 'update'", () => {
      assertEquals(isValidHMRMessageType("update"), true);
    });

    it("should return true for 'reload'", () => {
      assertEquals(isValidHMRMessageType("reload"), true);
    });

    it("should return true for 'ping'", () => {
      assertEquals(isValidHMRMessageType("ping"), true);
    });

    it("should return true for 'pong'", () => {
      assertEquals(isValidHMRMessageType("pong"), true);
    });

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
