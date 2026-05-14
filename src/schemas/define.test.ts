import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
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

  it("caches the built schema across repeated calls", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());

    const getSchema = defineSchema((v) => v.string());
    const first = getSchema();
    const second = getSchema();
    assertEquals(first === second, true);
  });

  it("defers adapter resolution until first call", () => {
    reset();
    const getSchema = defineSchema((v) => v.boolean());

    // No contract yet — construction alone must not throw.
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
});
