import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { isOptionalSchema, zodToJsonSchema } from "./zod-json-schema.ts";

const s = <T>(factory: (v: Parameters<Parameters<typeof defineSchema>[0]>[0]) => Schema<T>) =>
  defineSchema(factory)();

describe("zodToJsonSchema", () => {
  describe("primitive types", () => {
    it("should convert v.string()", () => {
      assertEquals(zodToJsonSchema(s((v) => v.string())), { type: "string" });
    });

    it("should convert v.number()", () => {
      assertEquals(zodToJsonSchema(s((v) => v.number())), { type: "number" });
    });

    it("should convert v.boolean()", () => {
      assertEquals(zodToJsonSchema(s((v) => v.boolean())), { type: "boolean" });
    });

    it("should convert v.bigint()", () => {
      assertEquals(zodToJsonSchema(s((v) => v.bigint())), { type: "integer" });
    });
  });

  describe("literal types", () => {
    it("should convert string literal", () => {
      const result = zodToJsonSchema(s((v) => v.literal("hello")));
      assertEquals(result, { const: "hello", type: "string" });
    });

    it("should convert number literal", () => {
      const result = zodToJsonSchema(s((v) => v.literal(42)));
      assertEquals(result, { const: 42, type: "number" });
    });

    it("should convert boolean literal", () => {
      const result = zodToJsonSchema(s((v) => v.literal(true)));
      assertEquals(result, { const: true, type: "boolean" });
    });
  });

  describe("enum types", () => {
    it("should convert v.enum()", () => {
      const result = zodToJsonSchema(s((v) => v.enum(["a", "b", "c"])));
      assertEquals(result, { type: "string", enum: ["a", "b", "c"] });
    });

    it("should convert a union of string literals", () => {
      const result = zodToJsonSchema(
        s((v) => v.union([v.literal("active"), v.literal("inactive")])),
      );
      assertEquals(result.anyOf?.[0], { const: "active", type: "string" });
      assertEquals(result.anyOf?.[1], { const: "inactive", type: "string" });
    });
  });

  describe("object types", () => {
    it("should convert simple object", () => {
      const result = zodToJsonSchema(
        s((v) => v.object({ name: v.string(), age: v.number() })),
      );
      assertEquals(result.type, "object");
      assertEquals(result.properties?.name, { type: "string" });
      assertEquals(result.properties?.age, { type: "number" });
      assertEquals(result.required?.includes("name"), true);
      assertEquals(result.required?.includes("age"), true);
    });

    it("should mark optional fields as not required", () => {
      const result = zodToJsonSchema(
        s((v) => v.object({ required: v.string(), optional: v.string().optional() })),
      );
      assertEquals(result.required, ["required"]);
    });

    it("should handle empty object", () => {
      const result = zodToJsonSchema(s((v) => v.object({})));
      assertEquals(result.type, "object");
      assertEquals(result.properties, {});
    });

    it("should handle nested objects", () => {
      const result = zodToJsonSchema(
        s((v) => v.object({ nested: v.object({ value: v.number() }) })),
      );
      assertEquals(result.properties?.nested?.type, "object");
      assertEquals(result.properties?.nested?.properties?.value, { type: "number" });
    });

    it("should preserve passthrough object policy", () => {
      const result = zodToJsonSchema(s((v) => v.object({}).passthrough()));
      assertEquals(result.additionalProperties, true);
    });

    it("should preserve strict object policy", () => {
      const result = zodToJsonSchema(s((v) => v.object({ name: v.string() }).strict()));
      assertEquals(result.additionalProperties, false);
    });
  });

  describe("array types", () => {
    it("should convert v.array()", () => {
      const result = zodToJsonSchema(s((v) => v.array(v.string())));
      assertEquals(result, { type: "array", items: { type: "string" } });
    });

    it("should convert v.tuple()", () => {
      const result = zodToJsonSchema(s((v) => v.tuple([v.string(), v.number()])));
      assertEquals(result.type, "array");
      assertEquals(result.prefixItems, [{ type: "string" }, { type: "number" }]);
      assertEquals(result.minItems, 2);
      assertEquals(result.maxItems, 2);
    });
  });

  describe("nullable types", () => {
    it("should wrap nullable types with anyOf", () => {
      const result = zodToJsonSchema(s((v) => v.string().nullable()));
      assertEquals(result, { anyOf: [{ type: "string" }, { type: "null" }] });
    });
  });

  describe("union types", () => {
    it("should convert v.union()", () => {
      const result = zodToJsonSchema(s((v) => v.union([v.string(), v.number()])));
      assertEquals(result, { anyOf: [{ type: "string" }, { type: "number" }] });
    });

    it("should convert v.discriminatedUnion()", () => {
      const result = zodToJsonSchema(
        s((v) =>
          v.discriminatedUnion("type", [
            v.object({ type: v.literal("a"), value: v.string() }),
            v.object({ type: v.literal("b"), count: v.number() }),
          ])
        ),
      );
      assertEquals(result.anyOf?.length, 2);
      assertEquals(result.anyOf?.[0]?.type, "object");
      assertEquals(result.anyOf?.[1]?.type, "object");
    });
  });

  describe("record types", () => {
    it("should convert v.record()", () => {
      const result = zodToJsonSchema(s((v) => v.record(v.string(), v.number())));
      assertEquals(result, {
        type: "object",
        additionalProperties: { type: "number" },
      });
    });
  });

  describe("default values", () => {
    it("should include default in schema", () => {
      const result = zodToJsonSchema(s((v) => v.string().default("hello")));
      assertEquals(result, { type: "string", default: "hello" });
    });
  });

  describe("lazy types", () => {
    it("should convert v.lazy()", () => {
      const result = zodToJsonSchema(s((v) => v.lazy(() => v.string())));
      assertEquals(result, { type: "string" });
    });
  });

  describe("effects types", () => {
    it("should convert v.string().refine() (effects)", () => {
      const result = zodToJsonSchema(s((v) => v.string().refine((val) => val.length > 0)));
      assertEquals(result, { type: "string" });
    });

    it("should convert v.string().transform() (effects)", () => {
      const result = zodToJsonSchema(
        s((v) => v.string().transform((val) => val.toUpperCase())),
      );
      assertEquals(result, { type: "string" });
    });
  });

  describe("error handling", () => {
    it("should throw for invalid schemas", () => {
      assertThrows(
        () => zodToJsonSchema(null as unknown as Schema<unknown>),
        Error,
        "Invalid Zod schema",
      );
    });

    it("should throw for schema without _def", () => {
      assertThrows(
        () => zodToJsonSchema({} as unknown as Schema<unknown>),
        Error,
        "Invalid Zod schema",
      );
    });
  });
});

describe("isOptionalSchema", () => {
  it("should return false for required schemas", () => {
    assertEquals(isOptionalSchema(s((v) => v.string())), false);
  });

  it("should return true for optional schemas", () => {
    assertEquals(isOptionalSchema(s((v) => v.string().optional())), true);
  });

  it("should return true for nested optional (nullable + optional)", () => {
    assertEquals(isOptionalSchema(s((v) => v.string().nullable().optional())), true);
  });
});
