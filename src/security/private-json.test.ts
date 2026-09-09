import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { privateJsonStringify } from "./private-json.ts";

describe("private JSON serialization", () => {
  it("reports unreadable arrays without exposing the underlying access error", () => {
    const array = new Proxy(["synthetic private value"], {
      get() {
        throw new Error("synthetic private detail");
      },
    });
    assertThrows(
      () => privateJsonStringify({ array }),
      TypeError,
      "Array input cannot be safely copied",
    );
  });
  it("preserves native scalar data without calling their serialization methods", () => {
    const value = {
      text: "å🙂",
      list: [undefined, NaN, Infinity],
      date: new Date(0),
      url: new URL("https://example.test/path"),
    };
    assertEquals(privateJsonStringify(value, null, 2), JSON.stringify(value, null, 2));
    assertEquals(privateJsonStringify(new Date(NaN)), "null");
    assertEquals(privateJsonStringify(() => {}), undefined);
  });

  it("rejects oversized sparse arrays and unsupported replacers", () => {
    assertThrows(() => privateJsonStringify(new Array(100_001)), TypeError);
    assertThrows(() => privateJsonStringify({ keep: 1 }, ["keep"] as never), TypeError);
    assertThrows(() => privateJsonStringify({ keep: 1 }, (() => undefined) as never), TypeError);
  });

  it("serializes own data without invoking inherited object or array hooks", () => {
    let reads = 0;
    const hook = {
      get toJSON() {
        reads++;
        return function (this: unknown) {
          return this;
        };
      },
    };
    const event = Object.create(hook, {
      text: { value: "Synthetic private output", enumerable: true },
    });
    const events = [event];
    const arrayPrototype = Object.create(Array.prototype, Object.getOwnPropertyDescriptors(hook));
    Object.setPrototypeOf(events, arrayPrototype);
    assertEquals(
      privateJsonStringify({ events, optional: undefined }),
      '{"events":[{"text":"Synthetic private output"}]}',
    );
    assertEquals(reads, 0);
  });

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
