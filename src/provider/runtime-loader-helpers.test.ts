import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWarningCollector,
  jsonValuesEqual,
  readProviderOptions,
  snapshotJsonValue,
  stringifyJsonValue,
  stringifyToolArguments,
  stringifyToolResultValue,
  unwrapToolInputSchema,
} from "./runtime-loader.ts";

function captureThrownError(
  fn: () => unknown,
  expectedType?: typeof Error,
  messageIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    if (messageIncludes && !error.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include ${messageIncludes}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

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

  it("always returns JSON text for serializable provider values", () => {
    assertEquals(stringifyJsonValue({ ok: true }), '{"ok":true}');
    assertEquals(stringifyJsonValue(null), "null");
    assertEquals(stringifyJsonValue(42), "42");
    assertEquals(stringifyJsonValue("text"), '"text"');
  });

  it("preserves string tool results without weakening general JSON serialization", () => {
    assertEquals(stringifyToolResultValue("text"), "text");
    assertEquals(stringifyToolResultValue(""), "");
    assertEquals(stringifyToolResultValue('{"ok":true}'), '{"ok":true}');
    assertEquals(stringifyToolResultValue({ ok: true }), '{"ok":true}');
  });

  it("matches JSON.stringify on undefined members without loosening the strict snapshot", () => {
    // The load_skill result from run b2eca9d0, whose undefined allowedTools
    // aborted the next model call.
    const toolResult = {
      skillId: "morning-email-summary",
      instructions: "# Instructions",
      allowedTools: undefined,
      references: [],
      scripts: [],
    };
    assertEquals(stringifyToolResultValue(toolResult), JSON.stringify(toolResult));
    assertEquals(stringifyJsonValue({ a: undefined, b: 1 }), '{"b":1}');
    assertEquals(stringifyJsonValue({ a: undefined }), "{}");
    assertEquals(stringifyJsonValue([1, undefined, 2]), "[1,null,2]");
    assertEquals(
      stringifyJsonValue({ nested: { a: undefined, b: [undefined] } }),
      '{"nested":{"b":[null]}}',
    );

    // The audit primitive stays fail-closed.
    assertThrows(() => snapshotJsonValue({ value: undefined }), TypeError);
    assertThrows(() => snapshotJsonValue([undefined]), TypeError);
    assertEquals(jsonValuesEqual({ hidden: undefined }, {}), false);
  });

  it("preserves provider-native tool argument text without weakening structured serialization", () => {
    assertEquals(stringifyToolArguments('{"id":"one"}'), '{"id":"one"}');
    assertEquals(stringifyToolArguments({ id: "one" }), '{"id":"one"}');
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
    let toJsonCalls = 0;
    const error = captureThrownError(
      () =>
        stringifyJsonValue({
          toJSON() {
            toJsonCalls += 1;
            throw new Error(privateDiagnostic);
          },
        }),
      TypeError,
      "must be JSON-serializable",
    );
    assertEquals(toJsonCalls, 0);
    assertEquals(error.message.includes(privateDiagnostic), false);
    assertEquals(error.cause, undefined);
  });

  it("rejects Proxy values without invoking traps at any compound node", () => {
    let trapCalls = 0;
    const hostile = new Proxy({ safe: true }, {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("private getPrototypeOf trap");
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error("private ownKeys trap");
      },
      getOwnPropertyDescriptor() {
        trapCalls += 1;
        throw new Error("private descriptor trap");
      },
    });

    for (const value of [hostile, { nested: [hostile] }]) {
      assertThrows(
        () => stringifyJsonValue(value),
        TypeError,
        "must be JSON-serializable",
      );
      assertThrows(
        () => snapshotJsonValue(value),
        TypeError,
        "must not contain Proxy values",
      );
    }
    assertEquals(trapCalls, 0);

    const { proxy, revoke } = Proxy.revocable({ safe: true }, {});
    revoke();
    assertThrows(
      () => stringifyJsonValue({ nested: proxy }),
      TypeError,
      "must be JSON-serializable",
    );
    assertThrows(
      () => snapshotJsonValue({ nested: proxy }),
      TypeError,
      "must not contain Proxy values",
    );
  });

  it("fails closed for object snapshots without Proxy detection", async () => {
    const script = `
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const {
        canIdentifyProxyWithoutHooks,
      } = await import("./src/platform/compat/error-introspection.ts");
      const { jsonValuesEqual, snapshotJsonValue, stringifyJsonValue } = await import(
        "./src/provider/runtime-loader.ts"
      );

      let calls = 0;
      let getterCalls = 0;
      const accessor = Object.defineProperty({}, "safe", {
        enumerable: true,
        get() {
          getterCalls += 1;
          return true;
        },
      });
      const proxy = new Proxy({ safe: true }, {
        getPrototypeOf(target) {
          calls += 1;
          return Reflect.getPrototypeOf(target);
        },
        getOwnPropertyDescriptor(target, property) {
          calls += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        ownKeys(target) {
          calls += 1;
          return Reflect.ownKeys(target);
        },
      });

      const result = {
        canIdentifyProxyWithoutHooks,
        primitive: snapshotJsonValue("safe"),
        calls,
        plainObject: "",
        providerObject: "",
        providerAccessor: stringifyJsonValue(accessor),
        providerEquality: jsonValuesEqual('{"safe":true}', { safe: true }, true),
        getterCalls,
        proxy: "",
        providerProxy: "",
      };
      try {
        snapshotJsonValue({ safe: true });
      } catch (error) {
        result.plainObject = error instanceof Error ? error.message : String(error);
      }
      try {
        result.providerObject = stringifyJsonValue({ safe: true });
      } catch (error) {
        result.providerObject = error instanceof Error ? error.message : String(error);
      }
      try {
        snapshotJsonValue(proxy);
      } catch (error) {
        result.proxy = error instanceof Error ? error.message : String(error);
      }
      try {
        stringifyJsonValue({ nested: proxy });
      } catch (error) {
        result.providerProxy = error instanceof Error ? error.message : String(error);
      }
      console.log(JSON.stringify(result));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "--config=deno.json", script],
      cwd: new URL("../../", import.meta.url),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.code, 0, stderr);

    const result = JSON.parse(new TextDecoder().decode(output.stdout));
    assertEquals(result, {
      canIdentifyProxyWithoutHooks: false,
      primitive: "safe",
      calls: 0,
      plainObject: "Provider JSON snapshot cannot inspect object values without Proxy detection",
      providerObject: '{"safe":true}',
      providerAccessor: '{"safe":true}',
      providerEquality: true,
      getterCalls: 1,
      proxy: "Provider JSON snapshot cannot inspect object values without Proxy detection",
      providerProxy: "Provider tool value must be JSON-serializable",
    });
  });

  it("serializes only owned snapshots without invoking getters or toJSON", () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "private";
      },
    });
    const customSerialization = {
      toJSON() {
        toJsonCalls += 1;
        return { leaked: true };
      },
    };

    assertThrows(() => stringifyJsonValue(accessor), TypeError, "must be JSON-serializable");
    assertThrows(
      () => stringifyJsonValue({ nested: customSerialization }),
      TypeError,
      "must be JSON-serializable",
    );
    assertEquals(getterCalls, 0);
    assertEquals(toJsonCalls, 0);
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

    const accessorError = captureThrownError(
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
    const methodError = captureThrownError(
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

  it("reads snapshot options only from own data properties", () => {
    const optionKeys = [
      "maxDepth",
      "maxNodes",
      "maxBytes",
      "sortObjectKeys",
    ] as const;

    for (let index = 0; index < optionKeys.length; index += 1) {
      const key = optionKeys[index]!;
      let getterCalls = 0;
      const options = Object.defineProperty({}, key, {
        configurable: true,
        get() {
          getterCalls += 1;
          return key === "sortObjectKeys" ? false : 1;
        },
      });

      assertThrows(
        () => snapshotJsonValue(null, options),
        TypeError,
        "options must use own data properties",
      );
      assertEquals(getterCalls, 0);
    }

    const inheritedOptions = Object.create({
      maxDepth: 0,
      maxNodes: 1,
      maxBytes: 1,
      sortObjectKeys: false,
    });
    assertEquals(
      Object.keys(snapshotJsonValue({ b: 2, a: 1 }, inheritedOptions) as object),
      ["a", "b"],
    );
    assertEquals(
      Object.keys(
        snapshotJsonValue({ b: 2, a: 1 }, { sortObjectKeys: false }) as object,
      ),
      ["b", "a"],
    );
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

    const error = captureThrownError(
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

    const error = captureThrownError(
      () => unwrapToolInputSchema(schema),
      TypeError,
      "jsonSchema property could not be read",
    );
    assertEquals(error.cause, undefined);
  });
});
