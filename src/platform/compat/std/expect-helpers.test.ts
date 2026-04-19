import { assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertDeepEqualityMatch,
  assertExpectation,
  getPromiseRejection,
  selectExpectationMessage,
} from "./expect-helpers.ts";

describe("platform/compat/std/expect-helpers", () => {
  it("selects the positive message when not negated", () => {
    const message = selectExpectationMessage("yes", "no", false);
    if (message !== "yes") throw new Error("wrong message");
  });

  it("selects the negative message when negated", () => {
    const message = selectExpectationMessage("yes", "no", true);
    if (message !== "no") throw new Error("wrong message");
  });

  it("asserts matching expectations", () => {
    assertExpectation(true, false, "boom");
    assertExpectation(false, true, "boom");
  });

  it("throws when the expectation fails", () => {
    assertThrows(() => assertExpectation(false, false, "boom"), Error, "boom");
  });

  it("asserts deep equality matches and mismatches", async () => {
    assertDeepEqualityMatch({ a: 1 }, { a: 1 }, "equal", false);
    assertThrows(
      () => assertDeepEqualityMatch({ a: 1 }, { a: 2 }, "equal", false),
      Error,
      "Expected",
    );
  });

  it("captures promise rejection state", async () => {
    const resolved = await getPromiseRejection(Promise.resolve("ok"));
    if (resolved.rejected !== false || resolved.error !== undefined) {
      throw new Error("expected resolved promise state");
    }

    const rejected = await getPromiseRejection(Promise.reject(new Error("bad")));
    if (
      !(rejected.rejected && rejected.error instanceof Error && rejected.error.message === "bad")
    ) {
      throw new Error("expected rejected promise state");
    }
  });
});
