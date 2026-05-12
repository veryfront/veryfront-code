import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAbortError, stringifyToolError, throwIfAborted } from "./error-utils.ts";

describe("agent/runtime/error-utils", () => {
  describe("createAbortError", () => {
    it("returns the original Error instance when the reason is already an Error", () => {
      const reason = new Error("boom");
      assertStrictEquals(createAbortError(reason), reason);
    });

    it("creates an AbortError DOMException from a string reason", () => {
      const error = createAbortError("stop now");
      assertEquals(error instanceof DOMException, true);
      assertEquals(error.name, "AbortError");
      assertEquals(error.message, "stop now");
    });

    it("uses a default abort message when the reason is empty", () => {
      const error = createAbortError();
      assertEquals(error instanceof DOMException, true);
      assertEquals(error.name, "AbortError");
      assertEquals(error.message, "The operation was aborted");
    });
  });

  describe("throwIfAborted", () => {
    it("does nothing when the signal is not aborted", () => {
      const controller = new AbortController();
      assertEquals(throwIfAborted(controller.signal), undefined);
    });

    it("throws an AbortError when the signal has been aborted", () => {
      const controller = new AbortController();
      controller.abort("cancelled");

      assertThrows(
        () => throwIfAborted(controller.signal),
        DOMException,
        "cancelled",
      );
    });
  });

  describe("stringifyToolError", () => {
    it("returns non-empty strings unchanged", () => {
      assertEquals(stringifyToolError("tool failed"), "tool failed");
    });

    it("returns an Error message when available", () => {
      assertEquals(stringifyToolError(new Error("tool exploded")), "tool exploded");
    });

    it("stringifies structured values as JSON", () => {
      assertEquals(
        stringifyToolError({ code: "E_TOOL", retryable: true }),
        '{"code":"E_TOOL","retryable":true}',
      );
    });

    it("falls back to String() when JSON serialization fails", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      assertEquals(stringifyToolError(circular), "[object Object]");
    });
  });
});
