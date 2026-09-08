import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { privateJsonStringify } from "./private-json.ts";

describe("private JSON serialization", () => {
  it("preserves JSON data, omission rules, sparse arrays, and indentation", () => {
    const value = { text: "hello", nested: [1, , undefined, null], absent: undefined };
    assertEquals(privateJsonStringify(value), JSON.stringify(value));
    assertEquals(privateJsonStringify(value, null, 2), JSON.stringify(value, null, 2));
    assertEquals(privateJsonStringify(undefined), undefined);
    const shared = { value: 1 };
    assertEquals(privateJsonStringify([shared, shared]), '[{"value":1},{"value":1}]');
  });

  it("does not dispatch own serialization hooks or property accessors", () => {
    let observations = 0;
    const value = {
      text: "synthetic-private-json-marker",
      toJSON() {
        observations++;
        return this;
      },
    };
    assertEquals(privateJsonStringify(value), '{"text":"synthetic-private-json-marker"}');
    assertThrows(() =>
      privateJsonStringify({
        get text() {
          observations++;
          return "private";
        },
      }), TypeError);
    assertEquals(observations, 0);
  });

  it("rejects cycles and bigint values", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    assertThrows(() => privateJsonStringify(value), TypeError);
    assertThrows(() => privateJsonStringify(1n), TypeError);
  });
});
