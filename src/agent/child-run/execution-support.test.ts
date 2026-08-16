import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isNativeError } from "node:util/types";
import {
  formatChildRunStreamPartError,
  isChildRunAbortError,
  throwIfChildRunAborted,
  toChildRunToolInputRecord,
} from "./execution-support.ts";

/**
 * A genuine Error whose prototype chain does not lead to this realm's
 * `Error.prototype` — exactly what an Error created in a worker, a `vm`
 * context, or a second instance of this module graph looks like to
 * `instanceof`. Re-prototyping a real Error reproduces that shape
 * deterministically on Deno, Node and Bun alike, where merely hoping a loader
 * hands out two `Error` bindings does not.
 */
function crossRealmError(message: string, name = "CrossRealmError"): Error {
  const error = new Error(message);
  Object.setPrototypeOf(error, { name });
  return error;
}

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
      const reason = new Error("custom reason");
      const controller = new AbortController();
      controller.abort(reason);

      assertStrictEquals(
        controller.signal.reason,
        reason,
        "AbortSignal must retain the supplied Error reason by identity",
      );
      assertEquals(
        isNativeError(controller.signal.reason),
        true,
        "node:util/types must retain the supplied Error brand",
      );

      assertThrows(() => throwIfChildRunAborted(controller.signal), Error, "custom reason");
    });

    it("throws an Error reason that was minted outside this realm", () => {
      const reason = crossRealmError("cancelled by the parent run");
      const controller = new AbortController();
      controller.abort(reason);

      let thrown: unknown;
      try {
        throwIfChildRunAborted(controller.signal);
      } catch (error) {
        thrown = error;
      }

      assertStrictEquals(thrown, reason);
    });

    it("still normalizes reasons that are not errors at all", () => {
      for (const reason of [undefined, "cancelled", { name: "Error", message: "shaped" }]) {
        const controller = new AbortController();
        controller.abort(reason);

        let thrownName = "";
        try {
          throwIfChildRunAborted(controller.signal);
        } catch (error) {
          thrownName = (error as Error).name;
        }

        assertEquals(thrownName, "AbortError");
      }
    });
  });

  describe("isChildRunAbortError", () => {
    it("recognizes AbortError instances", () => {
      assertEquals(isChildRunAbortError(new DOMException("aborted", "AbortError")), true);
    });

    it("recognizes an AbortError raised outside this realm", () => {
      assertEquals(isChildRunAbortError(crossRealmError("cancelled", "AbortError")), true);
    });

    it("rejects regular errors and non-error values", () => {
      assertEquals(isChildRunAbortError(new Error("not abort")), false);
      assertEquals(isChildRunAbortError({ name: "AbortError", message: "shaped" }), false);
      assertEquals(isChildRunAbortError(null), false);
      assertEquals(isChildRunAbortError("string"), false);
      assertEquals(isChildRunAbortError(undefined), false);
    });
  });

  describe("formatChildRunStreamPartError", () => {
    it("extracts Error messages and stringifies other values", () => {
      assertEquals(formatChildRunStreamPartError(new Error("oops")), "oops");
      assertEquals(
        formatChildRunStreamPartError(crossRealmError("oops elsewhere")),
        "oops elsewhere",
      );
      assertEquals(formatChildRunStreamPartError("raw"), "raw");
      assertEquals(formatChildRunStreamPartError(42), "42");
      assertEquals(formatChildRunStreamPartError(null), "null");
    });
  });
});
