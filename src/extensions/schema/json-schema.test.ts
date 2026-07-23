import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonSchema, JsonSchemaTypeName } from "veryfront/extensions/schema";

describe("extensions/schema JsonSchema", () => {
  it("accepts standard and vendor extension keywords without casts", () => {
    const schema: JsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Documentation URL",
      type: "string",
      format: "uri",
      pattern: "^https://",
      "x-veryfront-visibility": "public",
    };

    assertEquals(schema.format, "uri");
    assertEquals(schema["x-veryfront-visibility"], "public");
  });

  it("models integer and multi-type JSON Schema declarations", () => {
    const integerType: JsonSchemaTypeName = "integer";
    const integerSchema: JsonSchema = { type: integerType, minimum: 0 };
    const nullableStringSchema: JsonSchema = { type: ["string", "null"] };

    assertEquals(integerSchema.type, "integer");
    assertEquals(nullableStringSchema.type, ["string", "null"]);
  });
});
