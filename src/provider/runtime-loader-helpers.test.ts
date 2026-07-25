import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWarningCollector,
  readProviderOptions,
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
