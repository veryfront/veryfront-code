import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { stringifyChatJson, toChatJsonValue } from "./json-value.ts";

Deno.test("chat JSON normalization is cycle-safe and does not invoke accessors", () => {
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

Deno.test("chat JSON normalization applies deterministic resource limits", () => {
  assertEquals(
    toChatJsonValue({ nested: { value: true } }, { maxDepth: 1 }),
    { nested: { value: "[Truncated]" } },
  );
  assertEquals(
    stringifyChatJson(["abcdefgh"], { maxStringChars: 4 }),
    '["abcd"]',
  );
  assertThrows(
    () => toChatJsonValue({}, { maxNodes: 0 }),
    TypeError,
    "maxNodes",
  );
});
