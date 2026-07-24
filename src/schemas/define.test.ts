import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { JsonSchema, Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "./define.ts";
import { compileJsonSchemaValidator, tryCompileJsonSchemaValidator } from "./json-schema.ts";
import { createRuntimeJsonSchema } from "#veryfront/agent/runtime/runtime-tool-builder.ts";
import { lazySchema } from "./lazy.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

/**
 * `defineSchema` resolves the SchemaValidator contract on first call. App
 * bootstrap registers the zod adapter via ext-schema-zod.
 */
describe("defineSchema", () => {
  afterEach(() => {
    // Restore default state for any subsequent tests in the same process.
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

  it(
    "throws when no SchemaValidator contract is registered",
    () => {
      reset();
      const getSchema = defineSchema((v) => v.object({ id: v.string() }));
      assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);
      assertThrows(
        () => getSchema().parse({ id: "abc" }),
        Error,
        "@veryfront/ext-schema-zod",
      );
    },
  );

  it("materializes the schema lazily via the registered adapter", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const getSchema = defineSchema((v) =>
      v.object({ id: v.string().min(1), count: v.number().int() })
    );

    const schema = getSchema();
    const parsed = schema.parse({ id: "abc", count: 3 });
    assertEquals(parsed, { id: "abc", count: 3 });
  });

  it("caches the built schema across repeated calls", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const getSchema = defineSchema((v) => v.string());
    const first = getSchema();
    const second = getSchema();
    assertEquals(first === second, true);
  });

  it("rejects malformed factory results at materialization", () => {
    const getSchema = defineSchema(() => null as never);

    assertThrows(
      () => getSchema(),
      TypeError,
      "Schema factory must return a Schema",
    );
  });

  it("fails clearly when a factory re-enters its own getter", () => {
    const holder = {} as { getSchema: () => Schema<string> };
    const getSchema = defineSchema(() => holder.getSchema());
    holder.getSchema = getSchema;

    assertThrows(
      () => getSchema(),
      Error,
      "Schema factory recursively invoked its own getter",
    );
  });

  it("defers adapter resolution until first call", () => {
    reset();
    const getSchema = defineSchema((v) => v.boolean());

    // No contract yet. Construction alone must not throw.
    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);

    register<SchemaValidator>("SchemaValidator", createZodAdapter());
    const schema = getSchema();
    assertEquals(schema.parse(true), true);
  });

  it("imports public schema modules without a registered adapter", async () => {
    reset();
    const cacheBust = crypto.randomUUID();

    await import(`../config/schemas/config.schema.ts?lazy-import=${cacheBust}`);
    await import(`../integrations/schema.ts?lazy-import=${cacheBust}`);
    await import(`../agent/runtime/load-skill-tool.ts?lazy-import=${cacheBust}`);

    assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);
  });

  it("composes lazy schemas through adapter-backed object shapes", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const getNameSchema = defineSchema((v) => v.string().min(1));
    const nameSchema = lazySchema(getNameSchema);
    const getObjectSchema = defineSchema((v) => v.object({ name: nameSchema }));

    assertEquals(getObjectSchema().parse({ name: "Veryfront" }), { name: "Veryfront" });
  });

  it("fails clearly when the registered adapter cannot compile raw JSON Schema", () => {
    reset();
    const { compileJsonSchema: _unsupported, ...legacyAdapter } = createZodAdapter();
    register<SchemaValidator>("SchemaValidator", legacyAdapter);

    assertThrows(
      () => compileJsonSchemaValidator({ type: "object" }),
      Error,
      "cannot compile JSON Schema",
    );
  });

  it("rejects malformed compiled-validator results", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", {
      ...createZodAdapter(),
      compileJsonSchema: () => null as never,
    });

    assertThrows(
      () => compileJsonSchemaValidator({ type: "object" }),
      TypeError,
      "must return a validation function",
    );
    assertThrows(
      () => tryCompileJsonSchemaValidator({ type: "object" }),
      TypeError,
      "must return a validation function",
    );
  });

  it("reads the optional JSON Schema compiler capability once", () => {
    reset();
    const adapter = createZodAdapter();
    let compilerReads = 0;
    Object.defineProperty(adapter, "compileJsonSchema", {
      configurable: true,
      get() {
        compilerReads += 1;
        if (compilerReads > 1) return undefined;
        return <T = unknown>() => (input: unknown) => ({
          success: true as const,
          value: input as T,
        });
      },
    });
    register<SchemaValidator>("SchemaValidator", adapter);

    const compiled = compileJsonSchemaValidator({ type: "object" });

    assertEquals(compiled({ name: "Veryfront" }), {
      success: true,
      value: { name: "Veryfront" },
    });
    assertEquals(compilerReads, 1);
  });

  it("rejects unsafe raw JSON Schema before invoking the adapter compiler", () => {
    reset();
    let compileCalls = 0;
    let accessorReads = 0;
    register<SchemaValidator>("SchemaValidator", {
      ...createZodAdapter(),
      compileJsonSchema: <T = unknown>() => {
        compileCalls += 1;
        return (input) => ({ success: true, value: input as T });
      },
    });
    const unsafeSchema: Record<string, unknown> = {};
    Object.defineProperty(unsafeSchema, "type", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return "object";
      },
    });

    assertThrows(
      () => compileJsonSchemaValidator(unsafeSchema),
      TypeError,
      "must be a bounded JSON Schema object",
    );
    assertEquals(compileCalls, 0);
    assertEquals(accessorReads, 0);
  });

  it("passes a data-only snapshot to a custom JSON Schema compiler", () => {
    reset();
    let compilerInput: unknown;
    let descriptorReads = 0;
    let valueReads = 0;
    const target = { type: "object" as const };
    const schema = new Proxy(target, {
      getOwnPropertyDescriptor(_target, property) {
        if (property !== "type") return undefined;
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: "object",
        };
      },
      get(_target, property, receiver) {
        if (property === "type") {
          valueReads += 1;
          return () => "not-json";
        }
        return Reflect.get(_target, property, receiver);
      },
    });
    register<SchemaValidator>("SchemaValidator", {
      ...createZodAdapter(),
      compileJsonSchema: <T = unknown>(input: JsonSchema) => {
        compilerInput = input;
        return (value) => ({ success: true, value: value as T });
      },
    });

    compileJsonSchemaValidator(schema);

    assertEquals(compilerInput, { type: "object" });
    assertEquals(compilerInput === schema, false);
    assertEquals(descriptorReads, 1);
    assertEquals(valueReads, 0);
  });

  it("does not require optional raw-schema compilation until validation is attempted", () => {
    reset();
    const { compileJsonSchema: _unsupported, ...legacyAdapter } = createZodAdapter();
    register<SchemaValidator>("SchemaValidator", legacyAdapter);

    const runtimeSchema = createRuntimeJsonSchema({ type: "object" });

    assertEquals(runtimeSchema.jsonSchema, { type: "object" });
    assertThrows(
      () => runtimeSchema.validate({}),
      Error,
      "cannot compile JSON Schema",
    );
  });
});
