import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "./define.ts";
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

  it("rejects non-callable factories and lazy getters at the public boundary", () => {
    assertThrows(
      () => defineSchema(null as never),
      TypeError,
      "Schema factory must be a function",
    );
    assertThrows(
      () => lazySchema(null as never),
      TypeError,
      "Schema getter must be a function",
    );
  });

  it("caches the built schema across repeated calls", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const getSchema = defineSchema((v) => v.string());
    const first = getSchema();
    const second = getSchema();
    assertEquals(first === second, true);
  });

  it("fails fast when a schema factory resolves recursively", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    function resolveSelf(): Schema<string> {
      return getSchema();
    }
    const getSchema = defineSchema<string>(resolveSelf);

    assertThrows(() => getSchema(), TypeError, "recursively");
  });

  it("rejects invalid factory results without caching the failure", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
    let factoryCalls = 0;
    const getSchema = defineSchema(() => {
      factoryCalls++;
      return null as never;
    });

    assertThrows(() => getSchema(), TypeError, "invalid schema");
    assertThrows(() => getSchema(), TypeError, "invalid schema");
    assertEquals(factoryCalls, 2);
  });

  it("rejects invalid lazy getter results without caching the failure", () => {
    let getterCalls = 0;
    const schema = lazySchema(() => {
      getterCalls++;
      return null as never;
    });

    assertThrows(() => schema.parse("value"), TypeError, "invalid schema");
    assertThrows(() => schema.parse("value"), TypeError, "invalid schema");
    assertEquals(getterCalls, 2);
  });

  it("rejects incomplete lazy schema objects at materialization", () => {
    let getterCalls = 0;
    const schema = lazySchema(() => {
      getterCalls++;
      return {} as Schema<string>;
    });

    assertThrows(() => schema.parse("value"), TypeError, "invalid schema");
    assertThrows(() => schema.parse("value"), TypeError, "invalid schema");
    assertEquals(getterCalls, 2);
  });

  it("fails fast when a lazy getter resolves to its own facade", () => {
    const holder = {} as { schema: Schema<string> };
    holder.schema = lazySchema(() => holder.schema);

    assertThrows(() => holder.schema.parse("value"), TypeError, "recursively");
  });

  it("fails fast when lazy aliases form a cycle", () => {
    const holder = {} as { first: Schema<string>; second: Schema<string> };
    holder.first = lazySchema(() => holder.second);
    holder.second = lazySchema(() => holder.first);

    assertThrows(() => holder.first.parse("value"), TypeError, "recursively");
  });

  it("defers adapter resolution until first call", () => {
    reset();
    const getSchema = defineSchema((v) => v.boolean());

    // No contract exists yet, so construction alone must not throw.
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

  it("preserves the native receiver for extension-specific methods", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const nativeSchema = defineSchema((v) => v.string())();
    const owners = new WeakSet<object>([nativeSchema as object]);
    Object.defineProperty(nativeSchema, "isNativeReceiver", {
      configurable: true,
      value(this: object) {
        return owners.has(this);
      },
    });

    const schema = lazySchema(() => nativeSchema) as unknown as {
      isNativeReceiver(): boolean;
    };
    assertEquals(schema.isNativeReceiver(), true);
  });

  it("forwards every schema contract method with the backing receiver", () => {
    const contractMethods = [
      "optional",
      "nullable",
      "nullish",
      "default",
      "describe",
      "refine",
      "superRefine",
      "transform",
      "strict",
      "strip",
      "passthrough",
      "partial",
      "extend",
      "merge",
      "omit",
      "pick",
      "min",
      "max",
      "int",
      "positive",
      "nonnegative",
      "regex",
      "email",
      "url",
      "uuid",
      "datetime",
      "pipe",
      "parse",
      "safeParse",
    ] as const;
    const calls: string[] = [];
    const holder = {} as { backing: Schema<unknown> };
    holder.backing = new Proxy({ _output: undefined } as Schema<unknown>, {
      get(target, property, receiver) {
        if (property === "_output") return Reflect.get(target, property, receiver);
        return function (this: unknown): Schema<unknown> {
          assertEquals(this, holder.backing);
          calls.push(String(property));
          return holder.backing;
        };
      },
    });
    const schema = lazySchema(() => holder.backing) as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    for (const method of contractMethods) schema[method]?.(undefined);

    assertEquals(calls, [...contractMethods]);
  });

  it("remains usable when a consumer freezes the lazy facade", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const schema = lazySchema(defineSchema((v) => v.string().min(1)));

    Object.freeze(schema);
    assertEquals(schema.parse("Veryfront"), "Veryfront");
    assertEquals(Object.isFrozen(schema), true);
  });
});
