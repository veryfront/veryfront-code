import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createZodAdapter } from "./adapter.ts";

describe("SchemaValidator missing object input compatibility", () => {
  it("validates omitted unconstrained fields as undefined without inventing keys", () => {
    const validator = createZodAdapter();
    const schema = validator.object({
      unknownValue: validator.unknown(),
      anyValue: validator.any(),
      customValue: validator.custom<unknown>(() => true),
    });
    const missing = schema.safeParse({});
    assert(missing.success);
    assertEquals(missing.data, {});
    const present = schema.parse({
      unknownValue: undefined,
      anyValue: undefined,
      customValue: undefined,
    });
    assertEquals(Object.keys(present), ["unknownValue", "anyValue", "customValue"]);
  });

  it("still runs and propagates required refinements for absent fields", () => {
    const validator = createZodAdapter();
    let checks = 0;
    const schema = validator.object({
      value: validator.unknown().refine((value) => {
        checks++;
        return value !== undefined;
      }, "Value required"),
    });
    const result = schema.safeParse({});
    assert(!result.success);
    assertEquals(checks, 1);
    assertEquals(result.issues.map(({ code, path }) => ({ code, path })), [
      { code: "custom", path: ["value"] },
    ]);
    assert(
      !validator.object({ value: validator.custom((value) => value !== undefined) })
        .safeParse({}).success,
    );
  });

  it("retains defaults produced by transforms of omitted unconstrained values", () => {
    const validator = createZodAdapter();
    const schema = validator.object({
      value: validator.unknown().transform((value) => value ?? "fallback"),
    });
    assertEquals(schema.parse({}), { value: "fallback" });
  });

  it("keeps unconstrained and custom pipeline JSON Schema metadata unchanged", () => {
    const validator = createZodAdapter();
    assertEquals(validator.toJsonSchema(validator.unknown()), {});
    assertEquals(validator.toJsonSchema(validator.any()), {});
    assertEquals(
      validator.toJsonSchema(
        validator.custom<unknown>(() => true).pipe(validator.string()),
      ),
      { type: "string" },
    );
    const required = validator.object({
      value: validator.unknown().refine((value) => value !== undefined),
    });
    assertEquals(validator.toJsonSchema(required), {
      type: "object",
      properties: { value: {} },
      required: ["value"],
    });
  });

  it("keeps opaque promise values synchronous and unchanged", () => {
    const validator = createZodAdapter();
    const value = Promise.resolve("opaque");
    assertStrictEquals(validator.unknown().parse(value), value);
    assertStrictEquals(validator.any().parse(value), value);
    assertStrictEquals(
      validator.object({ value: validator.unknown() }).parse({ value }).value,
      value,
    );
  });
});
