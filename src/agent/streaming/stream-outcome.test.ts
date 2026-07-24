import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getStreamErrorMessage,
  hasCompletedStepSignal,
  isLateProviderBodyReadError,
  resolveKnownProviderTerminalError,
} from "./stream-outcome.ts";

describe("agent/stream-outcome", () => {
  describe("getStreamErrorMessage", () => {
    it("returns the message from an Error", () => {
      assertEquals(getStreamErrorMessage(new Error("boom")), "boom");
    });

    it("returns a string error as-is", () => {
      assertEquals(getStreamErrorMessage("plain failure"), "plain failure");
    });

    it("reads message from a plain object", () => {
      assertEquals(getStreamErrorMessage({ message: "object failure" }), "object failure");
    });

    it("stringifies anything else", () => {
      assertEquals(getStreamErrorMessage(42), "42");
      assertEquals(getStreamErrorMessage(null), "null");
      assertEquals(getStreamErrorMessage({ message: 7 }), "[object Object]");
    });
  });

  describe("isLateProviderBodyReadError", () => {
    it("matches the late body-read failure regardless of case", () => {
      assertEquals(
        isLateProviderBodyReadError(new Error("Error reading a body from connection: reset")),
        true,
      );
      assertEquals(
        isLateProviderBodyReadError("error reading a body from connection"),
        true,
      );
    });

    it("rejects other errors", () => {
      assertEquals(isLateProviderBodyReadError(new Error("connection refused")), false);
      assertEquals(isLateProviderBodyReadError(undefined), false);
    });
  });

  describe("hasCompletedStepSignal", () => {
    it("accepts every completed finish reason", () => {
      for (const reason of ["stop", "length", "tool-calls", "content-filter", "other"]) {
        assertEquals(hasCompletedStepSignal(reason), true, reason);
      }
    });

    it("rejects null, unknown, and error finish reasons", () => {
      assertEquals(hasCompletedStepSignal(null), false);
      assertEquals(hasCompletedStepSignal("error"), false);
      assertEquals(hasCompletedStepSignal("unknown"), false);
    });
  });

  describe("resolveKnownProviderTerminalError", () => {
    it("returns null for the generic provider service error", () => {
      assertEquals(resolveKnownProviderTerminalError(new Error("boom")), null);
    });

    it("returns code and message for a recognized terminal error", () => {
      const error = Object.assign(new Error("schema"), {
        responseBody: "Invalid Veryfront schema: defineSchema missing",
      });

      const resolved = resolveKnownProviderTerminalError(error);
      assertEquals(resolved?.code, "PROJECT_SCHEMA_ERROR");
      assertEquals(typeof resolved?.message, "string");
    });
  });
});
