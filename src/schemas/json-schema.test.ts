import "./_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema, lazySchema, schemaIsOptional, schemaToJsonSchema } from "./index.ts";

describe("JSON Schema helpers", () => {
  it("converts lazy contract schemas through the registered validator", () => {
    const schema = lazySchema(
      defineSchema((v) =>
        v.object({
          name: v.string(),
          count: v.number().default(1),
          note: v.string().optional(),
        })
      ),
    );

    assertEquals(schemaToJsonSchema(schema), {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number", default: 1 },
        note: { type: "string" },
      },
      required: ["name"],
    });
  });

  it("reports optional and defaulted schemas consistently", () => {
    const schema = lazySchema(defineSchema((v) => v.string()));

    assertEquals(schemaIsOptional(schema), false);
    assertEquals(schemaIsOptional(schema.optional()), true);
    assertEquals(schemaIsOptional(schema.default("fallback")), true);
  });
});
