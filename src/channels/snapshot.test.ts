import { assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  readDataProperty,
  readOwnDataProperty,
  snapshotDenseArray,
  snapshotJsonValue,
} from "./snapshot.ts";

describe("channels/snapshot", () => {
  describe("readOwnDataProperty", () => {
    it("distinguishes data, missing, and accessor properties without invoking accessors", () => {
      let accessorReads = 0;
      const input = { value: 1 };
      Object.defineProperty(input, "unsafe", {
        enumerable: true,
        get() {
          accessorReads += 1;
          return 2;
        },
      });

      assertEquals(readOwnDataProperty(input, "value"), {
        ok: true,
        present: true,
        value: 1,
      });
      assertEquals(readOwnDataProperty(input, "missing"), { ok: true, present: false });
      assertEquals(readOwnDataProperty(input, "unsafe"), { ok: false });
      assertEquals(readOwnDataProperty(null, "value"), { ok: false });
      assertEquals(accessorReads, 0);
    });

    it("fails closed when a property descriptor cannot be inspected", () => {
      const input = new Proxy({}, {
        getOwnPropertyDescriptor() {
          throw new TypeError("blocked");
        },
      });

      assertEquals(readOwnDataProperty(input, "value"), { ok: false });
    });
  });

  describe("readDataProperty", () => {
    it("finds inherited data methods and stops before built-in prototypes", () => {
      class Example {
        method(): string {
          return "ok";
        }
      }
      const input = new Example();
      const method = readDataProperty(input, "method");

      assertEquals(method.ok && method.present, true);
      assertEquals(
        method.ok && method.present && typeof method.value === "function"
          ? method.value.call(input)
          : undefined,
        "ok",
      );
      assertEquals(readDataProperty(input, "toString"), { ok: true, present: false });
    });

    it("rejects accessors, invalid limits, and prototype chains beyond the limit", () => {
      let accessorReads = 0;
      const parent = Object.create(null);
      Object.defineProperty(parent, "unsafe", {
        get() {
          accessorReads += 1;
          return "unsafe";
        },
      });
      const input = Object.create(parent);

      assertEquals(readDataProperty(input, "unsafe"), { ok: false });
      assertEquals(readDataProperty(input, "missing", 0), { ok: false });
      assertEquals(readDataProperty(input, "missing", -1), { ok: false });
      assertEquals(accessorReads, 0);
    });
  });

  describe("snapshotDenseArray", () => {
    it("clones a bounded dense array without using its iterator", () => {
      const input = [1, 2];
      Object.defineProperty(input, Symbol.iterator, {
        value() {
          throw new TypeError("iterator must not run");
        },
      });

      const result = snapshotDenseArray<number>(input, 2);
      assertEquals(result, { ok: true, value: [1, 2] });
      if (result.ok) assertNotStrictEquals(result.value, input);
    });

    it("rejects sparse, accessor-backed, oversized, and invalid inputs", () => {
      const sparse = new Array(1);
      const accessorBacked = [1];
      let accessorReads = 0;
      Object.defineProperty(accessorBacked, "0", {
        configurable: true,
        enumerable: true,
        get() {
          accessorReads += 1;
          return 1;
        },
      });

      assertEquals(snapshotDenseArray(sparse, 1), { ok: false });
      assertEquals(snapshotDenseArray(accessorBacked, 1), { ok: false });
      assertEquals(snapshotDenseArray([1, 2], 1), { ok: false });
      assertEquals(snapshotDenseArray([], -1), { ok: false });
      assertEquals(snapshotDenseArray({}, 1), { ok: false });
      assertEquals(accessorReads, 0);
    });
  });

  describe("snapshotJsonValue", () => {
    it("deeply clones JSON data into prototype-safe objects", () => {
      const shared = { value: 1 };
      const input = Object.create(null) as Record<string, unknown>;
      input.first = shared;
      input.second = shared;
      Object.defineProperty(input, "__proto__", {
        enumerable: true,
        value: { polluted: true },
      });

      const result = snapshotJsonValue(input);
      assertEquals(result.ok, true);
      if (!result.ok) return;

      assertEquals(Object.getPrototypeOf(result.value), null);
      if (
        typeof result.value === "object" && result.value !== null && !Array.isArray(result.value)
      ) {
        assertEquals(Object.keys(result.value).sort(), ["__proto__", "first", "second"]);
        assertEquals(result.value.first, { value: 1 });
        assertEquals(result.value.second, { value: 1 });
        assertEquals(result.value.__proto__, { polluted: true });
        assertNotStrictEquals(result.value.first, shared);
        assertNotStrictEquals(result.value.first, result.value.second);
      }
    });

    it("rejects accessors, cycles, sparse arrays, exotic values, and invalid primitives", () => {
      let accessorReads = 0;
      const accessorBacked = {};
      Object.defineProperty(accessorBacked, "unsafe", {
        enumerable: true,
        get() {
          accessorReads += 1;
          return "unsafe";
        },
      });
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      for (
        const input of [
          accessorBacked,
          cyclic,
          new Array(1),
          new Date(),
          Number.NaN,
          Number.POSITIVE_INFINITY,
          undefined,
          1n,
          Symbol("value"),
          () => undefined,
        ]
      ) {
        assertEquals(snapshotJsonValue(input), { ok: false });
      }
      assertEquals(accessorReads, 0);
    });

    it("enforces depth and node budgets and contains reflection failures", () => {
      assertEquals(snapshotJsonValue({ nested: true }, { maxDepth: 0 }), { ok: false });
      assertEquals(snapshotJsonValue([1], { maxNodes: 1 }), { ok: false });
      assertEquals(snapshotJsonValue({}, { maxDepth: -1 }), { ok: false });
      assertEquals(snapshotJsonValue({}, { maxNodes: 0 }), { ok: false });

      const input = new Proxy({}, {
        getPrototypeOf() {
          throw new TypeError("blocked");
        },
      });
      assertEquals(snapshotJsonValue(input), { ok: false });
    });
  });
});
