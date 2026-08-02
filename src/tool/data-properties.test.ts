import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getEnumerableOwnStringDataEntries,
  getOwnDataProperty,
  snapshotEnumerableOwnDataObject,
} from "./data-properties.ts";

describe("tool own-data-property helpers", () => {
  it("rejects accessor descriptors despite inherited prototype pollution", () => {
    const accessorBacked = Object.defineProperty({}, "field", {
      configurable: true,
      enumerable: true,
      get: () => "secret",
    });
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    Object.defineProperty(Object.prototype, "value", {
      configurable: true,
      value: "polluted",
      writable: true,
    });
    try {
      assertThrows(
        () => getOwnDataProperty(accessorBacked, "field", "test value"),
        TypeError,
        "own data properties",
      );
      assertThrows(
        () => getEnumerableOwnStringDataEntries(accessorBacked, "test value"),
        TypeError,
        "own data properties",
      );
      assertThrows(
        () => snapshotEnumerableOwnDataObject(accessorBacked, "test value"),
        TypeError,
        "own data properties",
      );
    } finally {
      if (original) {
        Object.defineProperty(Object.prototype, "value", original);
      } else {
        delete (Object.prototype as { value?: unknown }).value;
      }
    }
  });

  it("uses captured descriptor, key, and definition intrinsics", () => {
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalOwnKeys = Reflect.ownKeys;
    const originalDefineProperty = Reflect.defineProperty;
    let hookCalls = 0;
    Object.getOwnPropertyDescriptor = (() => {
      hookCalls += 1;
      throw new Error("mutated descriptor intrinsic");
    }) as typeof Object.getOwnPropertyDescriptor;
    Reflect.ownKeys = () => {
      hookCalls += 1;
      throw new Error("mutated key intrinsic");
    };
    Reflect.defineProperty = () => {
      hookCalls += 1;
      throw new Error("mutated definition intrinsic");
    };
    try {
      const input = { value: 42 };
      assertEquals(getOwnDataProperty(input, "value", "test value"), 42);
      assertEquals(getEnumerableOwnStringDataEntries(input, "test value"), [["value", 42]]);
      assertEquals(snapshotEnumerableOwnDataObject(input, "test value"), { value: 42 });
      assertEquals(hookCalls, 0);
    } finally {
      Object.getOwnPropertyDescriptor = originalGetOwnPropertyDescriptor;
      Reflect.ownKeys = originalOwnKeys;
      Reflect.defineProperty = originalDefineProperty;
    }
  });
});
