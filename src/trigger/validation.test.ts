import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertSerializable, isTriggerId } from "./validation.ts";

describe("trigger validation", () => {
  it("recognizes only canonical trigger identifiers", () => {
    for (const id of ["daily-triage", "billing.sync/v2", "0_internal"]) {
      assertEquals(isTriggerId(id), true);
    }
    for (const id of ["", "Daily Triage", " leading", "trailing ", 42, null]) {
      assertEquals(isTriggerId(id), false);
    }
  });

  it("accepts finite JSON data and repeated non-cyclic references", () => {
    const shared = { enabled: true };
    assertSerializable({
      string: "value",
      number: 42,
      boolean: false,
      nullable: null,
      omitted: undefined,
      list: [shared, shared],
    });
  });

  it("rejects non-finite numbers and cyclic data with a structured error", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, cyclic]) {
      assertThrows(
        () => assertSerializable(value),
        VeryfrontError,
        "must be JSON-serializable",
      );
    }
  });

  it("converts hostile object inspection into a structured validation error", () => {
    const throwingGetter = Object.defineProperty({}, "secret", {
      enumerable: true,
      get(): never {
        throw new Error("getter must not escape");
      },
    });
    const throwingPrototype = new Proxy({}, {
      getPrototypeOf(): never {
        throw new Error("prototype trap must not escape");
      },
    });

    for (const value of [throwingGetter, throwingPrototype]) {
      assertThrows(
        () => assertSerializable(value),
        VeryfrontError,
        "must be JSON-serializable",
      );
    }
  });
});
