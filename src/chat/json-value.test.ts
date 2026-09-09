import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { stringifyChatJson, toChatJsonValue } from "./json-value.ts";

describe("chat JSON normalization", () => {
  it("serializes within caller-selected limits without changing the input graph", () => {
    const values = Array.from({ length: 100_001 }, (_, index) => index);
    const options = { maxNodes: 100_002, maxContainerEntries: 100_001 };
    const parsed = JSON.parse(stringifyChatJson(values, options));
    assertEquals(parsed.length, values.length);
    assertEquals(parsed[100_000], 100_000);
    assertEquals(Object.getPrototypeOf(values), Array.prototype);
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let index = 0; index < 130; index++) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    assertEquals(stringifyChatJson(nested, { maxDepth: 140 }), JSON.stringify(nested));
  });
  it("is cycle-safe and does not invoke accessors", () => {
    let getterCalls = 0;
    const value: Record<string, unknown> = {
      bigint: 42n,
      infinity: Number.POSITIVE_INFINITY,
    };
    value.self = value;
    Object.defineProperty(value, "computed", {
      enumerable: true,
      get() {
        getterCalls++;
        return "unsafe";
      },
    });

    assertEquals(toChatJsonValue(value), {
      bigint: "42",
      computed: "[Accessor omitted]",
      infinity: null,
      self: "[Circular]",
    });
    assertEquals(getterCalls, 0);
  });

  it("applies deterministic resource limits", () => {
    assertEquals(
      toChatJsonValue({ nested: { value: true } }, { maxDepth: 1 }),
      { nested: { value: "[Truncated]" } },
    );
    assertEquals(
      stringifyChatJson(["abcdefgh"], { maxStringChars: 4 }),
      '["abcd"]',
    );
    assertEquals(
      stringifyChatJson(["a".repeat(40)], { maxStringChars: 20 }),
      JSON.stringify(["aaaaaaa… [truncated]"]),
      "a limit above the suffix length must mark the truncation",
    );
    assertEquals(
      toChatJsonValue([1, 2, 3], { maxContainerEntries: 2 }),
      [1, 2, "[Truncated] 1 array items"],
      "an array beyond maxContainerEntries must be capped and marked",
    );
    assertEquals(
      toChatJsonValue({ a: 1, b: 2, c: 3 }, { maxContainerEntries: 2 }),
      { a: 1, b: 2, __veryfront_truncated__: "1 object entries omitted" },
      "an object beyond maxContainerEntries must be capped and marked",
    );
    assertThrows(
      () => toChatJsonValue({}, { maxNodes: 0 }),
      TypeError,
      "maxNodes",
    );
  });

  it("converts Date and URL values to their canonical scalar forms", () => {
    assertEquals(
      toChatJsonValue({ at: new Date(0), url: new URL("https://example.test/x") }),
      { at: "1970-01-01T00:00:00.000Z", url: "https://example.test/x" },
      "Date must become an ISO string and URL its href",
    );
    assertEquals(
      toChatJsonValue({ at: new Date(Number.NaN) }),
      { at: null },
      "an invalid Date must become null, not an empty object",
    );
    assertEquals(
      toChatJsonValue([new Date(0)]),
      ["1970-01-01T00:00:00.000Z"],
      "the scalar conversion must apply inside arrays too",
    );
  });
});
