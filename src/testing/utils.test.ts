import { assert, assertEquals, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { deepEquals, safeStringify } from "./utils.ts";

describe("testing/utils", () => {
  describe("deepEquals", () => {
    it("compares built-in collection and value types by content", () => {
      assertEquals(deepEquals(new Date(0), new Date(1)), false);
      assertEquals(deepEquals(/value/gi, /value/g), false);
      assertEquals(deepEquals(new Map([["key", 1]]), new Map([["key", 2]])), false);
      assertEquals(deepEquals(new Set([1, 2]), new Set([2, 1])), true);
      assertEquals(deepEquals(new Set([1, 2]), new Set([1, 3])), false);
      assertEquals(deepEquals(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
      assertEquals(deepEquals(Object(1), Object(2)), false);
      assertEquals(
        deepEquals(
          new Error("failed", { cause: "first" }),
          new Error("failed", { cause: "second" }),
        ),
        false,
      );
      assertEquals(
        deepEquals(new Headers({ "x-value": "one" }), new Headers({ "x-value": "one" })),
        true,
      );
      assertEquals(
        deepEquals(new Headers({ "x-value": "one" }), new Headers({ "x-value": "two" })),
        false,
      );
      assertEquals(
        deepEquals(new Request("https://example.test"), new Request("https://example.test")),
        false,
      );
      assertEquals(deepEquals(new AbortController(), new AbortController()), false);
    });

    it("compares symbol properties and circular graph structure", () => {
      const key = Symbol("key");
      assertEquals(deepEquals({ [key]: 1 }, { [key]: 2 }), false);

      const circular: { self?: unknown } = {};
      circular.self = circular;
      const nonCircular = { self: {} };
      assertEquals(deepEquals(circular, nonCircular), false);
    });

    it("does not execute user-defined boxed primitive coercion", () => {
      let coercions = 0;
      const createValue = () => {
        const value = Object(1);
        Object.defineProperty(value, "valueOf", {
          value: () => {
            coercions++;
            return 2;
          },
        });
        return value;
      };

      assertEquals(deepEquals(createValue(), createValue()), true);
      assertEquals(coercions, 0);
    });

    it("does not execute overrides of built-in comparison methods", () => {
      let calls = 0;
      const createDate = () => {
        const value = new Date(0);
        Object.defineProperty(value, "getTime", {
          value: () => {
            calls++;
            return 0;
          },
        });
        return value;
      };
      class GuardedMap extends Map<string, number> {
        override entries(): MapIterator<[string, number]> {
          calls++;
          return super.entries();
        }
      }
      class GuardedHeaders extends Headers {
        override entries(): HeadersIterator<[string, string]> {
          calls++;
          return super.entries();
        }
      }
      const createUrl = () => {
        const value = new URL("https://example.test");
        Object.defineProperty(value, "href", {
          get: () => {
            calls++;
            return "https://example.test/";
          },
        });
        return value;
      };
      const createSearchParams = () => {
        const value = new URLSearchParams({ key: "value" });
        Object.defineProperty(value, "toString", {
          value: () => {
            calls++;
            return "key=value";
          },
        });
        return value;
      };
      const createRegExp = () => {
        const value = /key/gi;
        for (const property of ["source", "flags"] as const) {
          Object.defineProperty(value, property, {
            get: () => {
              calls++;
              return property === "source" ? "key" : "gi";
            },
          });
        }
        return value;
      };

      assertEquals(deepEquals(createDate(), createDate()), true);
      assertEquals(deepEquals(new GuardedMap([["key", 1]]), new GuardedMap([["key", 1]])), true);
      assertEquals(
        deepEquals(new GuardedHeaders({ key: "value" }), new GuardedHeaders({ key: "value" })),
        true,
      );
      assertEquals(deepEquals(createUrl(), createUrl()), true);
      assertEquals(deepEquals(createSearchParams(), createSearchParams()), true);
      assertEquals(deepEquals(createRegExp(), createRegExp()), true);
      assertEquals(calls, 0);
    });

    it("does not execute Symbol.toStringTag accessors", () => {
      let calls = 0;
      const prototype = Object.create(Object.prototype, {
        [Symbol.toStringTag]: {
          get: () => {
            calls++;
            return "Object";
          },
        },
      });
      const first = Object.assign(Object.create(prototype), { value: 1 });
      const second = Object.assign(Object.create(prototype), { value: 1 });

      assertEquals(deepEquals(first, second), false);
      assertEquals(calls, 0);
    });

    it("does not execute Error property accessors", () => {
      let calls = 0;
      const getter = () => {
        calls++;
        return "value";
      };
      const createError = () => {
        const error = new Error("value");
        for (const property of ["message", "cause"] as const) {
          Object.defineProperty(error, property, { configurable: true, get: getter });
        }
        return error;
      };

      assertEquals(deepEquals(createError(), createError()), true);
      assertEquals(calls, 0);
    });

    it("rejects opaque weak collections instead of treating them as equal", () => {
      assertThrows(() => deepEquals(new WeakMap(), new WeakMap()), TypeError);
      assertThrows(() => deepEquals(new WeakSet(), new WeakSet()), TypeError);
      assertThrows(() => deepEquals(new WeakRef({}), new WeakRef({})), TypeError);
    });

    it("enforces the comparison budget across collection candidates", () => {
      const size = 50_100;
      const actual = new Set(Array.from({ length: size }, (_, value) => ({ value })));
      const expected = new Set(
        Array.from({ length: size }, (_, value) => ({ value: value + size })),
      );

      assertThrows(() => deepEquals(actual, expected), RangeError);
    });

    it("rejects structures deep enough to exhaust the call stack", () => {
      const createDeepValue = () => {
        const root: { child?: unknown } = {};
        let current = root;
        for (let depth = 0; depth < 600; depth++) {
          const child: { child?: unknown } = {};
          current.child = child;
          current = child;
        }
        return root;
      };

      assertThrows(() => deepEquals(createDeepValue(), createDeepValue()), RangeError);
    });
  });

  describe("safeStringify", () => {
    it("formats circular and bigint values without throwing", () => {
      const value: { count: bigint; self?: unknown } = { count: 2n };
      value.self = value;

      const output = safeStringify(value);
      assert(output.includes("2n"));
      assert(output.includes("[Circular]"));
    });

    it("distinguishes shared references from circular references", () => {
      const shared = { value: 1 };
      assertEquals(
        safeStringify({ first: shared, second: shared }),
        '{"first":{"value":1},"second":{"value":1}}',
      );

      const circularMap = new Map<string, unknown>();
      circularMap.set("self", circularMap);
      assert(safeStringify(circularMap).includes("[Circular]"));
    });

    it("contains hostile proxy failures", () => {
      const hostile = new Proxy({}, {
        ownKeys() {
          throw new Error("private proxy detail");
        },
        get() {
          throw new Error("private proxy detail");
        },
      });

      assertEquals(safeStringify(hostile), "[Unserializable]");
    });

    it("does not execute Error accessors while formatting", () => {
      let calls = 0;
      const error = new Error("hidden");
      Object.defineProperty(error, "message", {
        get: () => {
          calls++;
          return "hidden";
        },
      });

      assert(safeStringify(error).includes("[Accessor]"));
      assertEquals(calls, 0);
    });

    it("does not execute object accessors or toJSON hooks", () => {
      let calls = 0;
      const value = {
        get secret() {
          calls++;
          return "private";
        },
        toJSON() {
          calls++;
          return { leaked: true };
        },
      };

      const output = safeStringify(value);
      assert(output.includes("[Accessor]"));
      assert(output.includes("[Function toJSON]"));
      assertEquals(calls, 0);
    });

    it("preserves RegExp details and enumerable symbol keys in diagnostics", () => {
      const key = Symbol("status");
      const output = safeStringify({ pattern: /ready/gi, [key]: "pending" });

      assert(output.includes("/ready/gi"));
      assert(output.includes("Symbol(status)"));
      assert(output.includes("pending"));
    });

    it("stops traversing values that exceed the serialization budget", () => {
      assertEquals(
        safeStringify(Array.from({ length: 20_000 }, (_, value) => value)),
        "[Truncated]",
      );

      class GuardedMap extends Map<number, number> {
        override entries(): MapIterator<[number, number]> {
          throw new Error("Serializer invoked an overridden iterator");
        }
      }

      const oversizedMap = new GuardedMap(
        Array.from({ length: 10_001 }, (_, value) => [value, value]),
      );
      assertEquals(safeStringify(oversizedMap), "[Truncated]");
    });

    it("bounds raw key inspection before reading property descriptors", () => {
      let descriptorReads = 0;
      const keys = Array.from({ length: 10_001 }, (_, index) => `hidden-${index}`);
      const oversized = new Proxy(Object.create(null), {
        ownKeys: () => keys,
        getOwnPropertyDescriptor: () => {
          descriptorReads++;
          return { configurable: true, enumerable: false, value: undefined };
        },
      });

      assertEquals(safeStringify(oversized), "[Truncated]");
      assertEquals(descriptorReads, 0);
    });
  });
});
