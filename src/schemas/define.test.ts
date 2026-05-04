import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/interfaces/index.ts";
import { defineSchema } from "./define.ts";
import { registerZodAdapter, zodAdapter } from "./zod-adapter.ts";

/**
 * The bootstrap side-effect import in `src/schemas/index.ts` registers the
 * zod adapter globally. These tests reset the registry between cases to
 * exercise both the "registered" and "unresolved" paths, then restore the
 * default state afterwards so downstream tests keep their invariants.
 */
describe("defineSchema", () => {
  afterEach(() => {
    // Restore default state for any subsequent tests in the same process.
    reset();
    registerZodAdapter();
  });

  it(
    "throws a helpful error when no SchemaValidator contract is registered",
    () => {
      reset();
      const getSchema = defineSchema((v) => v.object({ id: v.string() }));
      assertThrows(
        () => getSchema(),
        Error,
        "SchemaValidator contract unresolved — install ext-zod",
      );
    },
  );

  it("materializes the schema lazily via the registered adapter", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", zodAdapter);

    const getSchema = defineSchema((v) =>
      v.object({ id: v.string().min(1), count: v.number().int() })
    );

    const schema = getSchema();
    const parsed = schema.parse({ id: "abc", count: 3 });
    assertEquals(parsed, { id: "abc", count: 3 });
  });

  it("caches the built schema across repeated calls", () => {
    reset();
    register<SchemaValidator>("SchemaValidator", zodAdapter);

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

    register<SchemaValidator>("SchemaValidator", zodAdapter);
    const schema = getSchema();
    assertEquals(schema.parse(true), true);
  });
});
