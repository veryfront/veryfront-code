import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isBoundedJsonValue } from "./bounded-json.ts";

const LIMITS = {
  maxDepth: 4,
  maxNodes: 16,
  maxKeyLength: 8,
  maxStringLength: 16,
} as const;

describe("isBoundedJsonValue", () => {
  it("accepts only finite JSON values within the configured bounds", () => {
    assertEquals(
      isBoundedJsonValue(
        { enabled: true, items: [null, 1, "value"] },
        LIMITS,
      ),
      true,
    );
    assertEquals(isBoundedJsonValue(Number.NaN, LIMITS), false);
    assertEquals(isBoundedJsonValue(Number.POSITIVE_INFINITY, LIMITS), false);
    assertEquals(isBoundedJsonValue(undefined, LIMITS), false);
    assertEquals(isBoundedJsonValue(1n, LIMITS), false);
  });

  it("rejects objects whose JSON serialization would change their meaning", () => {
    assertEquals(isBoundedJsonValue(new Date(), LIMITS), false);
    assertEquals(isBoundedJsonValue(new Map([["key", "value"]]), LIMITS), false);
    assertEquals(isBoundedJsonValue({ value: undefined }, LIMITS), false);
    assertEquals(isBoundedJsonValue(["value", undefined], LIMITS), false);

    const withGetter = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "computed",
    });
    assertEquals(isBoundedJsonValue(withGetter, LIMITS), false);
  });

  it("rejects cycles, oversized values, and excessive nesting", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    assertEquals(isBoundedJsonValue(cyclic, LIMITS), false);
    assertEquals(isBoundedJsonValue({ longKeyName: true }, LIMITS), false);
    assertEquals(isBoundedJsonValue("x".repeat(17), LIMITS), false);
    assertEquals(
      isBoundedJsonValue({ a: { b: { c: { d: { e: true } } } } }, LIMITS),
      false,
    );
  });
});
