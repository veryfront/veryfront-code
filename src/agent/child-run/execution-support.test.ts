import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  formatChildRunStreamPartError,
  isChildRunAbortError,
  throwIfChildRunAborted,
  toChildRunToolInputRecord,
} from "./execution-support.ts";

describe("child-run-execution-support", () => {
  describe("toChildRunToolInputRecord", () => {
    it("converts plain objects to records", () => {
      assertEquals(toChildRunToolInputRecord({ a: 1, b: "two" }), { a: 1, b: "two" });
    });

    it("returns an empty record for nullish, array, and primitive inputs", () => {
      assertEquals(toChildRunToolInputRecord(null), {});
      assertEquals(toChildRunToolInputRecord(undefined), {});
      assertEquals(toChildRunToolInputRecord([1, 2, 3]), {});
      assertEquals(toChildRunToolInputRecord("string"), {});
      assertEquals(toChildRunToolInputRecord(42), {});
      assertEquals(toChildRunToolInputRecord(true), {});
    });
  });

  describe("throwIfChildRunAborted", () => {
    it("does nothing when the signal is absent or not aborted", () => {
      const controller = new AbortController();

      assertEquals(throwIfChildRunAborted(undefined), undefined);
      assertEquals(throwIfChildRunAborted(controller.signal), undefined);
    });

    it("throws an AbortError when the signal is aborted without a custom Error reason", () => {
      const controller = new AbortController();
      controller.abort();

      let thrownName = "";
      try {
        throwIfChildRunAborted(controller.signal);
      } catch (error) {
        if (error instanceof Error) {
          thrownName = error.name;
        }
      }

      assertEquals(thrownName, "AbortError");
    });

    it("throws the signal Error reason when present", () => {
      const controller = new AbortController();
      controller.abort(new Error("custom reason"));

      assertThrows(() => throwIfChildRunAborted(controller.signal), Error, "custom reason");
    });
  });

  describe("isChildRunAbortError", () => {
    it("recognizes AbortError instances", () => {
      assertEquals(isChildRunAbortError(new DOMException("aborted", "AbortError")), true);
    });

    it("rejects regular errors and non-error values", () => {
      assertEquals(isChildRunAbortError(new Error("not abort")), false);
      assertEquals(isChildRunAbortError(null), false);
      assertEquals(isChildRunAbortError("string"), false);
      assertEquals(isChildRunAbortError(undefined), false);
    });
  });

  describe("formatChildRunStreamPartError", () => {
    it("extracts Error messages and stringifies other values", () => {
      assertEquals(formatChildRunStreamPartError(new Error("oops")), "oops");
      assertEquals(formatChildRunStreamPartError("raw"), "raw");
      assertEquals(formatChildRunStreamPartError(42), "42");
      assertEquals(formatChildRunStreamPartError(null), "null");
    });
  });
});
