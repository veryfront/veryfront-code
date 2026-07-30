import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { findExtensionPropertyDescriptor } from "./property-inspection.ts";

describe("extension property inspection", () => {
  it("finds inherited data properties without invoking accessors", () => {
    let reads = 0;
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "method", {
      value: () => "ok",
      enumerable: false,
    });
    Object.defineProperty(prototype, "accessor", {
      get() {
        reads++;
        return "wrong";
      },
    });
    const value = Object.create(prototype);

    assertEquals(
      typeof findExtensionPropertyDescriptor(value, "method")?.value,
      "function",
    );
    assertEquals("get" in findExtensionPropertyDescriptor(value, "accessor")!, true);
    assertEquals(reads, 0);
  });

  it("rejects cyclic and excessively deep prototype chains", () => {
    const cyclic: object = new Proxy({}, { getPrototypeOf: () => cyclic });
    assertThrows(
      () => findExtensionPropertyDescriptor(cyclic, "missing"),
      TypeError,
      "invalid prototype chain",
    );

    let deep = Object.create(null);
    for (let index = 0; index < 32; index++) deep = Object.create(deep);
    assertThrows(
      () => findExtensionPropertyDescriptor(deep, "missing"),
      TypeError,
      "invalid prototype chain",
    );
  });
});
