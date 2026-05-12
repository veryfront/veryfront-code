import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { defineSchema } from "./define.ts";
import { createZodAdapter } from "../../extensions/ext-zod/src/adapter.ts";

/**
 * `defineSchema` resolves the SchemaValidator contract on first call. App
 * bootstrap registers the zod adapter via ext-zod, and the schema layer also
 * installs the same default adapter when public entrypoints materialize
 * schemas before full bootstrap has run.
 */
describe("defineSchema", () => {
  afterEach(() => {
    // Restore default state for any subsequent tests in the same process.
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

  it(
    "installs the default zod adapter when no SchemaValidator contract is registered",
    () => {
      reset();
      const getSchema = defineSchema((v) => v.object({ id: v.string() }));
      assertEquals(tryResolve<SchemaValidator>("SchemaValidator"), undefined);
      assertEquals(getSchema().parse({ id: "abc" }), { id: "abc" });
      assertEquals(!!tryResolve<SchemaValidator>("SchemaValidator"), true);
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
});
