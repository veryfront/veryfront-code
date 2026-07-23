import { assert, assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "veryfront/extensions/schema";
import { createZodAdapter } from "./adapter.ts";

async function validate(
  validator: JsonSchemaValidationFunction,
  input: unknown,
): Promise<JsonSchemaValidationResult> {
  return await validator(input);
}

describe("SchemaValidator.compileJsonSchema", () => {
  it("validates Draft 2020-12 schemas without mutating accepted input", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        count: { type: "integer" },
        label: { type: "string", default: "generated" },
      },
      required: ["count"],
      additionalProperties: false,
    });
    const input = { count: 2 };

    const result = await validate(validator, input);

    assertEquals(result, { success: true, value: input });
    assertEquals(input, { count: 2 });
  });

  it("selects the compiler declared by Draft 7 and Draft 2019-09 schemas", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const draft7 = compile({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { value: { type: "integer" } },
      required: ["value"],
    });
    const draft2019 = compile({
      $schema: "https://json-schema.org/draft/2019-09/schema",
      type: "array",
      items: { type: "string" },
    });

    assertEquals((await validate(draft7, { value: 1 })).success, true);
    assertEquals((await validate(draft7, { value: "1" })).success, false);
    assertEquals((await validate(draft2019, ["one", "two"])).success, true);
    assertEquals((await validate(draft2019, ["one", 2])).success, false);
  });

  it("supports JSON Schema union type arrays in strict mode", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: ["string", "null"],
    } as never);

    assertEquals((await validate(validator, "value")).success, true);
    assertEquals((await validate(validator, null)).success, true);
    assertEquals((await validate(validator, 1)).success, false);
  });

  it("reuses compiled schemas through a bounded adapter-local cache", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const first = compile({ type: "string", minLength: 1 });
    const equivalent = compile({ minLength: 1, type: "string" });

    assertEquals(equivalent === first, true);

    for (let index = 0; index < 128; index++) {
      compile({ type: "integer", minimum: index });
    }

    const recompiled = compile({ type: "string", minLength: 1 });
    assertEquals(recompiled === first, false);
  });

  it("snapshots cached schemas so later caller mutation cannot change validation", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const schema = { type: "string" as const, minLength: 2 };
    const validator = compile(schema);

    (schema as { type: string }).type = "number";
    schema.minLength = 100;

    assertEquals((await validate(validator, "ok")).success, true);
    assertEquals((await validate(validator, 42)).success, false);
  });

  it("rejects non-JSON schema values before they can collide in the cache", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);

    assertThrows(
      () => compile({ type: "number", minimum: Number.NaN }),
      TypeError,
      "finite",
    );
    assertThrows(
      () => compile({ type: "string", custom: new Date() } as never),
      TypeError,
      "plain JSON objects",
    );
  });

  it("rejects sparse and extended arrays regardless of cache insertion order", () => {
    const denseSchema = { enum: [[null]] } as never;
    const sparseValue: unknown[] = [];
    sparseValue.length = 1;
    const sparseSchema = { enum: [sparseValue] } as never;
    const extendedValue = [null] as unknown[] & { label?: string };
    extendedValue.label = "not-json-array-data";
    const extendedSchema = { enum: [extendedValue] } as never;

    const denseFirstCompile = createZodAdapter().compileJsonSchema;
    assert(denseFirstCompile);
    denseFirstCompile(denseSchema);
    assertThrows(() => denseFirstCompile(sparseSchema), TypeError, "dense JSON arrays");
    assertThrows(() => denseFirstCompile(extendedSchema), TypeError, "dense JSON arrays");

    const invalidFirstCompile = createZodAdapter().compileJsonSchema;
    assert(invalidFirstCompile);
    assertThrows(() => invalidFirstCompile(sparseSchema), TypeError, "dense JSON arrays");
    assertThrows(() => invalidFirstCompile(extendedSchema), TypeError, "dense JSON arrays");
    invalidFirstCompile(denseSchema);
  });

  it("rejects schema accessors without invoking them or poisoning the cache", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const cached = compile({ type: "string" });
    let objectGetterCalls = 0;
    let arrayGetterCalls = 0;
    const objectAccessor = { type: "string" } as Record<string, unknown>;
    Object.defineProperty(objectAccessor, "minLength", {
      enumerable: true,
      get() {
        objectGetterCalls++;
        return 2;
      },
    });
    const arrayAccessor: unknown[] = [];
    Object.defineProperty(arrayAccessor, "0", {
      enumerable: true,
      get() {
        arrayGetterCalls++;
        return "value";
      },
    });
    arrayAccessor.length = 1;

    assertThrows(
      () => compile(objectAccessor as never),
      TypeError,
      "accessors",
    );
    assertThrows(
      () => compile({ enum: [arrayAccessor] } as never),
      TypeError,
      "accessors",
    );
    assertEquals(objectGetterCalls, 0);
    assertEquals(arrayGetterCalls, 0);
    assertEquals(compile({ type: "string" }) === cached, true);
  });

  it("rejects hidden and symbol schema keys instead of aliasing cached schemas", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const cached = compile({ type: "string" });
    const hidden = { type: "string" } as Record<string, unknown>;
    Object.defineProperty(hidden, "minLength", {
      enumerable: false,
      value: 2,
    });
    const symbol = { type: "string" } as Record<PropertyKey, unknown>;
    symbol[Symbol("constraint")] = { minLength: 2 };

    assertThrows(
      () => compile(hidden as never),
      TypeError,
      "non-enumerable",
    );
    assertThrows(
      () => compile(symbol as never),
      TypeError,
      "symbol keys",
    );
    assertEquals(compile({ type: "string" }) === cached, true);
  });

  it("detects cycles while allowing repeated acyclic schema references", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const cyclic: Record<string, unknown> = { type: "object" };
    cyclic.properties = { self: cyclic };

    assertThrows(() => compile(cyclic as never), TypeError, "cycles");

    const shared = { type: "string" as const, minLength: 1 };
    const validator = compile({
      type: "object",
      properties: { left: shared, right: shared },
      required: ["left", "right"],
      additionalProperties: false,
    });
    assertEquals((await validate(validator, { left: "a", right: "b" })).success, true);
  });

  it("enforces explicit depth, node, string, key, and serialized-size bounds", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    let deeplyNested: unknown = { type: "string" };
    for (let depth = 0; depth < 130; depth++) {
      deeplyNested = { allOf: [deeplyNested] };
    }
    const tooManyNodes = new Array(100_001).fill(null);
    const tooLongString = "x".repeat(1024 * 1024 + 1);
    const tooLongKey = "k".repeat(16 * 1024 + 1);
    const maximumString = "x".repeat(1024 * 1024);

    assertThrows(
      () => compile(deeplyNested as never),
      TypeError,
      "maximum depth",
    );
    assertThrows(
      () => compile({ enum: [tooManyNodes] } as never),
      TypeError,
      "maximum node count",
    );
    assertThrows(
      () => compile({ description: tooLongString } as never),
      TypeError,
      "string exceeds",
    );
    assertThrows(
      () => compile({ [tooLongKey]: true } as never),
      TypeError,
      "key exceeds",
    );
    assertThrows(
      () => compile({ enum: [maximumString, maximumString, maximumString, maximumString] }),
      TypeError,
      "serialized limit",
    );
  });

  it("accepts null-prototype schemas and safely canonicalizes __proto__ data keys", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const properties = Object.create(null) as Record<string, unknown>;
    properties.value = { type: "string" };
    const schema = Object.assign(Object.create(null) as Record<string, unknown>, {
      type: "object",
      properties,
      required: ["value"],
      additionalProperties: false,
    });
    const input = Object.create(null) as Record<string, unknown>;
    input.value = "safe";
    const validator = compile(schema as never);

    assertEquals((await validate(validator, input)).success, true);
    assertEquals((await validate(validator, {})).success, false);

    const constant = Object.create(null) as Record<string, unknown>;
    constant.__proto__ = "safe";
    const constantValidator = compile({ const: constant } as never);
    assertEquals(
      (await validate(constantValidator, JSON.parse('{"__proto__":"safe"}'))).success,
      true,
    );
    assertEquals(
      (await validate(constantValidator, JSON.parse('{"__proto__":"wrong"}'))).success,
      false,
    );
  });

  it("does not coerce input or remove additional properties", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: "object",
      properties: { count: { type: "integer" } },
      required: ["count"],
      additionalProperties: false,
    });
    const input = { count: "2", extra: true };

    const result = await validate(validator, input);

    assertEquals(result.success, false);
    if (result.success) return;
    assertEquals(result.errors.map((error) => error.keyword).sort(), [
      "additionalProperties",
      "type",
    ]);
    assertEquals(input, { count: "2", extra: true });
  });

  it("copies validation errors before a later validation can replace them", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });

    const first = await validate(validator, {});
    assertEquals(first.success, false);
    if (first.success) return;
    const snapshot = structuredClone(first.errors);

    await validate(validator, { query: 42 });

    assertEquals(first.errors, snapshot);
  });

  it("normalizes asynchronous Ajv validation failures", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      $async: true,
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    });

    const result = await validate(validator, { query: 42 });

    assertEquals(result.success, false);
    if (result.success) return;
    assertEquals(result.errors.map((error) => error.keyword), ["type"]);
  });

  it("fails schema compilation for unsupported formats in strict mode", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);

    assertThrows(
      () => compile({ type: "string", format: "future-unknown-format" }),
      Error,
      "unknown format",
    );
  });

  it("validates the standard email, uri, uuid, and date-time formats", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        uri: { type: "string", format: "uri" },
        uuid: { type: "string", format: "uuid" },
        timestamp: { type: "string", format: "date-time" },
      },
      required: ["email", "uri", "uuid", "timestamp"],
      additionalProperties: false,
    });

    const valid = await validate(validator, {
      email: "hello@veryfront.com",
      uri: "https://veryfront.com/docs?section=schemas",
      uuid: "123e4567-e89b-42d3-a456-426614174000",
      timestamp: "2026-07-23T12:34:56Z",
    });
    assertEquals(valid.success, true);

    const invalid = await validate(validator, {
      email: "not-an-email",
      uri: "not a uri",
      uuid: "not-a-uuid",
      timestamp: "not-a-date-time",
    });
    assertEquals(invalid.success, false);
    if (invalid.success) return;
    assertEquals(
      invalid.errors.map(
        (error): [string, string] => [error.instancePath, error.keyword],
      ).sort(([left], [right]) => left.localeCompare(right)),
      [
        ["/email", "format"],
        ["/timestamp", "format"],
        ["/uri", "format"],
        ["/uuid", "format"],
      ],
    );
  });

  it("compiles independent schemas that reuse the same $id", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const first = compile({
      $id: "urn:veryfront:test:duplicate-id",
      type: "string",
      minLength: 3,
    });
    const second = compile({
      $id: "urn:veryfront:test:duplicate-id",
      type: "integer",
      minimum: 1,
    });

    assertEquals((await validate(first, "abc")).success, true);
    assertEquals((await validate(first, 2)).success, false);
    assertEquals((await validate(second, 2)).success, true);
    assertEquals((await validate(second, "abc")).success, false);
  });

  it("does not retain caller schemas in a shared compiler registry", () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);

    for (let index = 0; index < 128; index++) {
      compile({
        $id: `urn:veryfront:test:bounded-registry:${index}`,
        type: "object",
      });
    }

    assertThrows(
      () => compile({ $ref: "urn:veryfront:test:bounded-registry:0" }),
      Error,
      "can't resolve reference",
    );
  });

  it("does not satisfy required properties from an inherited prototype", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: "object",
      properties: { ownValue: { type: "string" } },
      required: ["ownValue"],
      additionalProperties: false,
    });
    const input = Object.create({ ownValue: "inherited" }) as Record<string, unknown>;

    const result = await validate(validator, input);

    assertEquals(result.success, false);
    if (result.success) return;
    assertEquals(result.errors.map((error) => error.keyword), ["required"]);
  });

  it("ignores inherited keys when enforcing additionalProperties", async () => {
    const compile = createZodAdapter().compileJsonSchema;
    assert(compile);
    const validator = compile({
      type: "object",
      properties: { ownValue: { type: "string" } },
      required: ["ownValue"],
      additionalProperties: false,
    });
    const input = Object.assign(
      Object.create({ inheritedExtra: true }) as Record<string, unknown>,
      { ownValue: "present" },
    );

    const result = await validate(validator, input);

    assertEquals(result.success, true);
  });
});
