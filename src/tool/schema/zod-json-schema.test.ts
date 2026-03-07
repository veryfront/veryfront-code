import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertThrows } from "#veryfront/testing/assert";
import { z } from "zod";
import { isOptionalSchema, zodToJsonSchema } from "./zod-json-schema.ts";

describe("zodToJsonSchema", () => {
  describe("primitive types", () => {
    it("should convert z.string()", () => {
      assertEquals(zodToJsonSchema(z.string()), { type: "string" });
    });

    it("should convert z.number()", () => {
      assertEquals(zodToJsonSchema(z.number()), { type: "number" });
    });

    it("should convert z.boolean()", () => {
      assertEquals(zodToJsonSchema(z.boolean()), { type: "boolean" });
    });

    it("should convert z.bigint()", () => {
      assertEquals(zodToJsonSchema(z.bigint()), { type: "integer" });
    });
  });

  describe("literal types", () => {
    it("should convert string literal", () => {
      const result = zodToJsonSchema(z.literal("hello"));
      assertEquals(result, { const: "hello", type: "string" });
    });

    it("should convert number literal", () => {
      const result = zodToJsonSchema(z.literal(42));
      assertEquals(result, { const: 42, type: "number" });
    });

    it("should convert boolean literal", () => {
      const result = zodToJsonSchema(z.literal(true));
      assertEquals(result, { const: true, type: "boolean" });
    });
  });

  describe("enum types", () => {
    it("should convert z.enum()", () => {
      const result = zodToJsonSchema(z.enum(["a", "b", "c"]));
      assertEquals(result, { type: "string", enum: ["a", "b", "c"] });
    });

    it("should convert z.nativeEnum()", () => {
      enum Status {
        Active = "active",
        Inactive = "inactive",
      }
      const result = zodToJsonSchema(z.nativeEnum(Status));
      assertEquals(result.enum?.includes("active"), true);
      assertEquals(result.enum?.includes("inactive"), true);
    });
  });

  describe("object types", () => {
    it("should convert simple object", () => {
      const result = zodToJsonSchema(z.object({ name: z.string(), age: z.number() }));
      assertEquals(result.type, "object");
      assertEquals(result.properties?.name, { type: "string" });
      assertEquals(result.properties?.age, { type: "number" });
      assertEquals(result.required?.includes("name"), true);
      assertEquals(result.required?.includes("age"), true);
    });

    it("should mark optional fields as not required", () => {
      const result = zodToJsonSchema(
        z.object({ required: z.string(), optional: z.string().optional() }),
      );
      assertEquals(result.required, ["required"]);
    });

    it("should handle empty object", () => {
      const result = zodToJsonSchema(z.object({}));
      assertEquals(result.type, "object");
      assertEquals(result.properties, {});
    });

    it("should handle nested objects", () => {
      const result = zodToJsonSchema(
        z.object({ nested: z.object({ value: z.number() }) }),
      );
      assertEquals(result.properties?.nested?.type, "object");
      assertEquals(result.properties?.nested?.properties?.value, { type: "number" });
    });
  });

  describe("array types", () => {
    it("should convert z.array()", () => {
      const result = zodToJsonSchema(z.array(z.string()));
      assertEquals(result, { type: "array", items: { type: "string" } });
    });

    it("should convert z.tuple()", () => {
      const result = zodToJsonSchema(z.tuple([z.string(), z.number()]));
      assertEquals(result.type, "array");
      assertEquals(result.prefixItems, [{ type: "string" }, { type: "number" }]);
      assertEquals(result.minItems, 2);
      assertEquals(result.maxItems, 2);
    });
  });

  describe("nullable types", () => {
    it("should wrap nullable types with anyOf", () => {
      const result = zodToJsonSchema(z.string().nullable());
      assertEquals(result, { anyOf: [{ type: "string" }, { type: "null" }] });
    });
  });

  describe("union types", () => {
    it("should convert z.union()", () => {
      const result = zodToJsonSchema(z.union([z.string(), z.number()]));
      assertEquals(result, { anyOf: [{ type: "string" }, { type: "number" }] });
    });

    it("should convert z.discriminatedUnion()", () => {
      const result = zodToJsonSchema(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("a"), value: z.string() }),
          z.object({ type: z.literal("b"), count: z.number() }),
        ]),
      );
      assertEquals(result.anyOf?.length, 2);
      assertEquals(result.anyOf?.[0]?.type, "object");
      assertEquals(result.anyOf?.[1]?.type, "object");
    });
  });

  describe("record types", () => {
    it("should convert z.record()", () => {
      const result = zodToJsonSchema(z.record(z.string(), z.number()));
      assertEquals(result, {
        type: "object",
        additionalProperties: { type: "number" },
      });
    });
  });

  describe("default values", () => {
    it("should include default in schema", () => {
      const result = zodToJsonSchema(z.string().default("hello"));
      assertEquals(result, { type: "string", default: "hello" });
    });
  });

  describe("lazy types", () => {
    it("should convert z.lazy()", () => {
      const result = zodToJsonSchema(z.lazy(() => z.string()));
      assertEquals(result, { type: "string" });
    });
  });

  describe("effects types", () => {
    it("should convert z.string().refine() (ZodEffects)", () => {
      const result = zodToJsonSchema(z.string().refine((s) => s.length > 0));
      assertEquals(result, { type: "string" });
    });

    it("should convert z.string().transform() (ZodEffects)", () => {
      const result = zodToJsonSchema(z.string().transform((s) => s.toUpperCase()));
      assertEquals(result, { type: "string" });
    });
  });

  describe("error handling", () => {
    it("should throw for invalid schemas", () => {
      assertThrows(
        () => zodToJsonSchema(null as unknown as z.ZodTypeAny),
        Error,
        "Invalid Zod schema",
      );
    });

    it("should throw for schema without _def", () => {
      assertThrows(
        () => zodToJsonSchema({} as unknown as z.ZodTypeAny),
        Error,
        "Invalid Zod schema",
      );
    });
  });
});

describe("isOptionalSchema", () => {
  it("should return false for required schemas", () => {
    assertEquals(isOptionalSchema(z.string()), false);
  });

  it("should return true for optional schemas", () => {
    assertEquals(isOptionalSchema(z.string().optional()), true);
  });

  it("should return true for nested optional (nullable + optional)", () => {
    assertEquals(isOptionalSchema(z.string().nullable().optional()), true);
  });
});
