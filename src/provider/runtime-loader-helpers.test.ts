import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWarningCollector,
  jsonValuesEqual,
  readProviderOptions,
  snapshotJsonValue,
  stringifyJsonValue,
  unwrapToolInputSchema,
} from "./runtime-loader.ts";

describe("provider/runtime-loader helpers", () => {
  it("drains warnings exactly once", () => {
    const warnings = createWarningCollector();
    warnings.push({
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
    });

    assertEquals(warnings.drain(), [{
      type: "unsupported-setting",
      provider: "openai",
      setting: "topK",
    }]);
    assertEquals(warnings.drain(), []);
  });

  it("always returns JSON text for serializable provider tool values", () => {
    assertEquals(stringifyJsonValue({ ok: true }), '{"ok":true}');
    assertEquals(stringifyJsonValue("text"), '"text"');
    assertEquals(stringifyJsonValue(null), "null");
  });

  it("rejects provider tool values without a JSON representation", () => {
    for (const value of [undefined, Symbol("value"), () => undefined, 1n]) {
      assertThrows(
        () => stringifyJsonValue(value),
        TypeError,
        "must be JSON-serializable",
      );
    }

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assertThrows(
      () => stringifyJsonValue(circular),
      TypeError,
      "must be JSON-serializable",
    );

    const privateDiagnostic = "private tool payload path";
    const error = assertThrows(
      () =>
        stringifyJsonValue({
          toJSON() {
            throw new Error(privateDiagnostic);
          },
        }),
      TypeError,
      "must be JSON-serializable",
    );
    assertEquals(error.message.includes(privateDiagnostic), false);
    assertEquals(error.cause, undefined);
  });

  it("compares provider JSON values semantically without hiding invalid values", () => {
    assertEquals(
      jsonValuesEqual(
        { nested: { second: 2, first: 1 }, values: [3, 2, 1] },
        { values: [3, 2, 1], nested: { first: 1, second: 2 } },
      ),
      true,
    );
    assertEquals(
      jsonValuesEqual(
        '{"query":"Veryfront","type":"search"}',
        { type: "search", query: "Veryfront" },
        true,
      ),
      true,
    );
    assertEquals(jsonValuesEqual('{"value":1}', { value: 1 }), false);
    assertEquals(jsonValuesEqual('{"value":1}', { value: 2 }, true), false);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assertEquals(jsonValuesEqual(circular, circular), false);
    assertEquals(jsonValuesEqual(undefined, undefined), false);
  });

  it("creates deeply owned, frozen snapshots with deterministic object keys", () => {
    const source = {
      z: [{ value: 1 }],
      a: Object.assign(Object.create(null), { safe: true }),
    };

    const snapshot = snapshotJsonValue(source);
    const root = snapshot as {
      readonly a: { readonly safe: boolean };
      readonly z: readonly [{ readonly value: number }];
    };

    assertEquals(Object.keys(root), ["a", "z"]);
    assertEquals(Object.getPrototypeOf(root), null);
    assertEquals(Object.isFrozen(root), true);
    assertEquals(Object.isFrozen(root.a), true);
    assertEquals(Object.isFrozen(root.z), true);
    assertEquals(Object.isFrozen(root.z[0]), true);
    assertEquals(Array.isArray(root.z), true);
    assertEquals(Object.getPrototypeOf(root.z), Array.prototype);

    source.z[0]!.value = 2;
    source.a.safe = false;
    assertEquals(root.z[0].value, 1);
    assertEquals(root.a.safe, true);
  });

  it("isolates array snapshots and equality from inherited array hooks", () => {
    const toJsonDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toJSON",
    );
    const everyDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "every",
    );
    let toJsonCalls = 0;
    let everyCalls = 0;

    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true,
      value() {
        toJsonCalls += 1;
        return ["rewritten"];
      },
    });
    Object.defineProperty(Array.prototype, "every", {
      configurable: true,
      value() {
        everyCalls += 1;
        return true;
      },
    });

    let snapshot: ReturnType<typeof snapshotJsonValue> | undefined;
    let roundTrip: ReturnType<typeof snapshotJsonValue> | undefined;
    let isArray = false;
    let prototype: object | null = null;
    let serialized = "";
    let iterated: unknown[] = [];
    let mapped: unknown[] = [];
    let serializationGuard: PropertyDescriptor | undefined;
    let arraysEqual = true;
    let objectsEqual = true;
    let forgedGuardRejected = false;
    try {
      snapshot = snapshotJsonValue([1, { safe: true }]);
      isArray = Array.isArray(snapshot);
      prototype = Object.getPrototypeOf(snapshot as object);
      serialized = JSON.stringify(snapshot);
      iterated = [...snapshot as readonly unknown[]];
      mapped = (snapshot as readonly unknown[]).map((value) => value);
      serializationGuard = Object.getOwnPropertyDescriptor(snapshot, "toJSON");
      arraysEqual = jsonValuesEqual([1], [2]);
      objectsEqual = jsonValuesEqual({ value: 1 }, { value: 2 });
      // A snapshot can safely cross the same boundary again.
      roundTrip = snapshotJsonValue(snapshot);

      const forgedSnapshot = [1];
      Object.defineProperty(forgedSnapshot, "toJSON", {
        configurable: false,
        enumerable: false,
        value: undefined,
        writable: false,
      });
      try {
        snapshotJsonValue(forgedSnapshot);
      } catch (error) {
        forgedGuardRejected = error instanceof TypeError;
      }
    } finally {
      if (toJsonDescriptor === undefined) {
        delete (Array.prototype as { toJSON?: unknown }).toJSON;
      } else {
        Object.defineProperty(Array.prototype, "toJSON", toJsonDescriptor);
      }
      if (everyDescriptor === undefined) {
        delete (Array.prototype as { every?: unknown }).every;
      } else {
        Object.defineProperty(Array.prototype, "every", everyDescriptor);
      }
    }

    assertEquals(isArray, true);
    assertEquals(prototype, Array.prototype);
    assertEquals(serialized, '[1,{"safe":true}]');
    assertEquals(iterated, [1, { safe: true }]);
    assertEquals(mapped, [1, { safe: true }]);
    assertEquals(serializationGuard, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    assertEquals(arraysEqual, false);
    assertEquals(objectsEqual, false);
    assertEquals(forgedGuardRejected, true);
    assertEquals(toJsonCalls, 0);
    assertEquals(everyCalls, 0);
    assertEquals(roundTrip, snapshot);
  });

  it("reads JSON object values through descriptors without invoking accessors or methods", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "private", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("private getter diagnostic");
      },
    });

    const accessorError = assertThrows(
      () => snapshotJsonValue(accessor),
      TypeError,
      "only enumerable data properties",
    );
    assertEquals(getterCalls, 0);
    assertEquals(accessorError.message.includes("private getter diagnostic"), false);

    let toJsonCalls = 0;
    const customSerialization = {
      safe: true,
      toJSON() {
        toJsonCalls += 1;
        throw new Error("private toJSON diagnostic");
      },
    };
    const methodError = assertThrows(
      () => snapshotJsonValue(customSerialization),
      TypeError,
      "without a JSON representation",
    );
    assertEquals(toJsonCalls, 0);
    assertEquals(methodError.message.includes("private toJSON diagnostic"), false);

    let nestedGetterCalls = 0;
    const nestedAccessor = Object.defineProperty([], "0", {
      configurable: true,
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return "unsafe";
      },
    });
    nestedAccessor.length = 1;
    assertThrows(
      () => snapshotJsonValue(nestedAccessor),
      TypeError,
      "only enumerable data properties",
    );
    assertEquals(nestedGetterCalls, 0);
  });

  it("rejects non-JSON object shapes and primitives instead of coercing them", () => {
    const sparse = new Array(1);
    assertThrows(
      () => snapshotJsonValue(sparse),
      TypeError,
      "arrays must be dense",
    );

    const extraArrayProperty = [1] as number[] & { extra?: boolean };
    extraArrayProperty.extra = true;
    assertThrows(
      () => snapshotJsonValue(extraArrayProperty),
      TypeError,
      "contain no extra properties",
    );

    const nonEnumerable = Object.defineProperty({}, "hidden", {
      enumerable: false,
      value: true,
    });
    assertThrows(
      () => snapshotJsonValue(nonEnumerable),
      TypeError,
      "only enumerable data properties",
    );

    const symbolProperty = { safe: true };
    Object.defineProperty(symbolProperty, Symbol("private"), {
      enumerable: true,
      value: "unsafe",
    });
    assertThrows(
      () => snapshotJsonValue(symbolProperty),
      TypeError,
      "must not contain symbol properties",
    );

    class CustomValue {
      readonly value = 1;
    }
    for (
      const value of [
        new Date(0),
        new CustomValue(),
        { value: undefined },
        [undefined],
        { value: 1n },
        { value: Symbol("value") },
        { value: () => undefined },
        NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]
    ) {
      assertThrows(() => snapshotJsonValue(value), TypeError);
    }

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assertThrows(
      () => snapshotJsonValue(circular),
      TypeError,
      "must not contain cycles",
    );
  });

  it("enforces exact depth, node, and canonical UTF-8 byte boundaries", () => {
    assertEquals(snapshotJsonValue({ leaf: null }, { maxDepth: 1 }), {
      leaf: null,
    });
    assertThrows(
      () => snapshotJsonValue({ leaf: null }, { maxDepth: 0 }),
      TypeError,
      "maximum depth 0",
    );

    assertEquals(snapshotJsonValue({ leaf: null }, { maxNodes: 2 }), {
      leaf: null,
    });
    assertThrows(
      () => snapshotJsonValue({ leaf: null }, { maxNodes: 1 }),
      TypeError,
      "exceeded 1 nodes",
    );

    // Canonical JSON is exactly 13 UTF-8 bytes: {"leaf":null}.
    assertEquals(
      snapshotJsonValue({ leaf: null }, { maxBytes: 13 }),
      { leaf: null },
    );
    assertThrows(
      () => snapshotJsonValue({ leaf: null }, { maxBytes: 12 }),
      TypeError,
      "exceeded 12 UTF-8 bytes",
    );

    // Quotation marks plus a two-byte UTF-8 code point.
    assertEquals(snapshotJsonValue("é", { maxBytes: 4 }), "é");
    assertThrows(
      () => snapshotJsonValue("é", { maxBytes: 3 }),
      TypeError,
      "exceeded 3 UTF-8 bytes",
    );

    // Lone surrogates are emitted as six-byte JSON escapes, plus two quotes.
    assertEquals(snapshotJsonValue("\ud800", { maxBytes: 8 }), "\ud800");
    assertThrows(
      () => snapshotJsonValue("\ud800", { maxBytes: 7 }),
      TypeError,
      "exceeded 7 UTF-8 bytes",
    );
  });

  it("validates snapshot resource options before traversing values", () => {
    for (
      const options of [
        { maxDepth: -1 },
        { maxDepth: 0.5 },
        { maxNodes: 0 },
        { maxNodes: Number.POSITIVE_INFINITY },
        { maxBytes: 0 },
        { maxBytes: Number.MAX_SAFE_INTEGER + 1 },
      ]
    ) {
      assertThrows(() => snapshotJsonValue(null, options), TypeError);
    }
  });

  it("makes JSON equality fail closed without invoking accessors or serialization hooks", () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return null;
      },
    });
    let toJsonCalls = 0;
    const customSerialization = {
      toJSON() {
        toJsonCalls += 1;
        return null;
      },
    };

    assertEquals(jsonValuesEqual(accessor, { value: null }), false);
    assertEquals(jsonValuesEqual(customSerialization, null), false);
    assertEquals(getterCalls, 0);
    assertEquals(toJsonCalls, 0);
    assertEquals(jsonValuesEqual({ hidden: undefined }, {}), false);
    assertEquals(jsonValuesEqual(new Array(1), [null]), false);
    assertEquals(jsonValuesEqual(NaN, null), false);
    assertEquals(jsonValuesEqual(-0, 0), true);
    assertEquals(jsonValuesEqual("not JSON", "not JSON", true), true);
  });

  it("bounds raw JSON text before parsing it for equality", () => {
    const maxBytes = 8 * 1024 * 1024;
    const atBoundary = `${" ".repeat(maxBytes - 4)}null`;
    const aboveBoundary = ` ${atBoundary}`;

    assertEquals(jsonValuesEqual(atBoundary, null, true), true);
    assertEquals(jsonValuesEqual(aboveBoundary, null, true), false);
  });

  it("merges provider options without interpreting __proto__ as a prototype setter", () => {
    const providerOptions = Object.fromEntries([
      [
        "custom",
        Object.fromEntries([
          ["__proto__", { inherited: true }],
          ["enabled", true],
        ]),
      ],
    ]);

    const merged = readProviderOptions(providerOptions, "custom");

    assertEquals(Object.getPrototypeOf(merged), Object.prototype);
    assertEquals(Object.hasOwn(merged, "__proto__"), true);
    assertEquals(merged.__proto__, { inherited: true });
    assertEquals((merged as { inherited?: boolean }).inherited, undefined);
  });

  it("ignores inherited provider option buckets", () => {
    const providerOptions = Object.create({
      custom: { inherited: true },
    }) as Record<string, unknown>;

    assertEquals(readProviderOptions(providerOptions, "custom"), {});
  });

  it("wraps hostile provider option accessors at the provider boundary", () => {
    const providerOptions = Object.defineProperty({}, "custom", {
      enumerable: true,
      get() {
        throw new Error("private provider option failure");
      },
    }) as Record<string, unknown>;

    const error = assertThrows(
      () => readProviderOptions(providerOptions, "custom"),
      TypeError,
      'Provider options for "custom" could not be read',
    );
    assertEquals(error.cause, undefined);
  });

  it("wraps hostile provider option ownership and nested accessors", () => {
    const hostileOwnership = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("private ownership failure");
      },
    }) as Record<string, unknown>;
    assertThrows(
      () => readProviderOptions(hostileOwnership, "custom"),
      TypeError,
      'Provider options for "custom" could not be read',
    );

    const hostileNestedOption = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        throw new Error("private nested option failure");
      },
    });
    assertThrows(
      () => readProviderOptions({ custom: hostileNestedOption }, "custom"),
      TypeError,
      'Provider options for "custom" could not be enumerated',
    );
  });

  it("wraps hostile tool schema accessors at the provider boundary", () => {
    const schema = Object.defineProperty({}, "jsonSchema", {
      get() {
        throw new Error("private schema failure");
      },
    });

    const error = assertThrows(
      () => unwrapToolInputSchema(schema),
      TypeError,
      "jsonSchema property could not be read",
    );
    assertEquals(error.cause, undefined);
  });
});
