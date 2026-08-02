import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createIntrinsicPromiseContinuation } from "./promise-intrinsics-internal.ts";

const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function restoreProperty(
  object: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(object, key);
    return;
  }
  defineProperty(object, key, descriptor);
}

describe("extension Promise intrinsics", () => {
  it("observes settlement without live constructor, species, or then hooks", async () => {
    const source = Promise.resolve(41);
    const originalSourceConstructor = {
      configurable: true,
      enumerable: true,
      value: Object.freeze({ id: "original-constructor" }),
      writable: true,
    };
    defineProperty(source, "constructor", originalSourceConstructor);

    const originalPrototypeConstructor = getOwnPropertyDescriptor(
      Promise.prototype,
      "constructor",
    );
    const originalSpecies = getOwnPropertyDescriptor(
      Promise,
      Symbol.species,
    );
    const originalThen = getOwnPropertyDescriptor(
      Promise.prototype,
      "then",
    );
    let constructorHooks = 0;
    let speciesHooks = 0;
    let thenHooks = 0;
    let continuation: Promise<number> | undefined;
    let observedSourceConstructor: PropertyDescriptor | undefined;

    try {
      defineProperty(Promise.prototype, "constructor", {
        configurable: true,
        get() {
          constructorHooks += 1;
          throw new Error("Promise constructor hook ran");
        },
      });
      defineProperty(Promise, Symbol.species, {
        configurable: true,
        get() {
          speciesHooks += 1;
          throw new Error("Promise species hook ran");
        },
      });
      defineProperty(Promise.prototype, "then", {
        configurable: true,
        value() {
          thenHooks += 1;
          throw new Error("Promise then hook ran");
        },
        writable: true,
      });

      continuation = createIntrinsicPromiseContinuation(
        source,
        (value) => value + 1,
        () => -1,
      );
      observedSourceConstructor = getOwnPropertyDescriptor(
        source,
        "constructor",
      );
    } finally {
      restoreProperty(
        Promise.prototype,
        "then",
        originalThen,
      );
      restoreProperty(Promise, Symbol.species, originalSpecies);
      restoreProperty(
        Promise.prototype,
        "constructor",
        originalPrototypeConstructor,
      );
    }

    if (continuation === undefined) {
      throw new Error("Expected an intrinsic Promise continuation");
    }
    assertEquals(await continuation, 42);
    assertEquals(observedSourceConstructor, originalSourceConstructor);
    assertEquals(constructorHooks, 0);
    assertEquals(speciesHooks, 0);
    assertEquals(thenHooks, 0);
  });

  it("removes its temporary constructor from an ordinary Promise", async () => {
    const source = Promise.resolve("value");
    assertEquals(
      getOwnPropertyDescriptor(source, "constructor"),
      undefined,
    );

    const continuation = createIntrinsicPromiseContinuation(
      source,
      (value) => value,
      () => "rejected",
    );

    assertEquals(
      getOwnPropertyDescriptor(source, "constructor"),
      undefined,
    );
    assertEquals(await continuation, "value");
  });

  it("fails closed without reading a fixed Promise constructor", () => {
    const source = Promise.resolve("value");
    let constructorReads = 0;
    defineProperty(source, "constructor", {
      configurable: false,
      get() {
        constructorReads += 1;
        throw new Error("fixed constructor getter ran");
      },
    });

    assertThrows(
      () =>
        createIntrinsicPromiseContinuation(
          source,
          (value) => value,
          () => "rejected",
        ),
      TypeError,
      "fixed constructor",
    );
    assertEquals(constructorReads, 0);
  });
});
