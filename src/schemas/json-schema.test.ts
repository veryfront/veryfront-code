import "./_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema, lazySchema, schemaIsOptional, schemaToJsonSchema } from "./index.ts";

describe("JSON Schema helpers", () => {
  it("converts contract schemas without exposing the validator implementation", () => {
    const schema = lazySchema(defineSchema((v) =>
      v.object({
        name: v.string(),
        count: v.number().optional(),
      })
    ));

    assertEquals(schemaToJsonSchema(schema), {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
      required: ["name"],
    });
  });

  it("detects optional and defaulted contract schemas", () => {
    const required = lazySchema(defineSchema((v) => v.string()));
    const optional = lazySchema(defineSchema((v) => v.string().optional()));
    const defaulted = lazySchema(defineSchema((v) => v.number().default(10)));

    assertEquals(schemaIsOptional(required), false);
    assertEquals(schemaIsOptional(optional), true);
    assertEquals(schemaIsOptional(defaulted), true);
  });

  it("rejects invalid schema arguments before adapter conversion", () => {
    assertThrows(
      () => schemaToJsonSchema(null as never),
      TypeError,
      "valid schema",
    );
    assertThrows(
      () => schemaIsOptional({} as never),
      TypeError,
      "valid schema",
    );
  });
});
