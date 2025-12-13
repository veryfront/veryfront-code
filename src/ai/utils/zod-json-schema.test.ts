import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert, assertExists } from "std/assert/mod.ts";
import { z } from "zod";
import { zodToJsonSchema, isOptionalSchema } from "./zod-json-schema.ts";

describe("zodToJsonSchema", () => {
  describe("primitive types", () => {
    it("should convert string schema", () => {
      const schema = z.string();
      const json = zodToJsonSchema(schema);
      assertEquals(json.type, "string");
    });

    it("should convert number schema", () => {
      const schema = z.number();
      const json = zodToJsonSchema(schema);
      assertEquals(json.type, "number");
    });

    it("should convert boolean schema", () => {
      const schema = z.boolean();
      const json = zodToJsonSchema(schema);
      assertEquals(json.type, "boolean");
    });

    it("should convert bigint schema", () => {
      const schema = z.bigint();
      const json = zodToJsonSchema(schema);
      assertEquals(json.type, "integer");
    });
  });

  describe("literal types", () => {
    it("should convert string literal", () => {
      const schema = z.literal("hello");
      const json = zodToJsonSchema(schema);
      assertEquals(json.const, "hello");
      assertEquals(json.type, "string");
    });

    it("should convert number literal", () => {
      const schema = z.literal(42);
      const json = zodToJsonSchema(schema);
      assertEquals(json.const, 42);
      assertEquals(json.type, "number");
    });

    it("should convert boolean literal", () => {
      const schema = z.literal(true);
      const json = zodToJsonSchema(schema);
      assertEquals(json.const, true);
      assertEquals(json.type, "boolean");
    });
  });

  describe("enum types", () => {
    it("should convert enum schema", () => {
      const schema = z.enum(["option1", "option2", "option3"]);
      const json = zodToJsonSchema(schema);
      assertEquals(json.type, "string");
      assertEquals(json.enum, ["option1", "option2", "option3"]);
    });

    it("should convert native enum schema", () => {
      enum TestEnum {
        A = "valueA",
        B = "valueB",
      }
      const schema = z.nativeEnum(TestEnum);
      const json = zodToJsonSchema(schema);
      assertExists(json.enum);
      assert(Array.isArray(json.enum));
    });
  });

  describe("object types", () => {
    it("should convert object schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "object");
      assertExists(json.properties);
      assertEquals(json.properties?.name, { type: "string" });
      assertEquals(json.properties?.age, { type: "number" });
      assertEquals(json.required, ["name", "age"]);
    });

    it("should handle optional properties", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });
      const json = zodToJsonSchema(schema);

      assertEquals(json.required, ["required"]);
      assert(!json.required?.includes("optional"));
    });

    it("should handle nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
      });
      const json = zodToJsonSchema(schema);

      assertExists(json.properties?.user);
      assertEquals(json.properties?.user.type, "object");
    });
  });

  describe("array types", () => {
    it("should convert array schema", () => {
      const schema = z.array(z.string());
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "array");
      assertEquals(json.items, { type: "string" });
    });

    it("should handle complex array items", () => {
      const schema = z.array(z.object({ id: z.number() }));
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "array");
      assertEquals(json.items?.type, "object");
    });
  });

  describe("tuple types", () => {
    it("should convert tuple schema", () => {
      const schema = z.tuple([z.string(), z.number(), z.boolean()]);
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "array");
      assertEquals(json.prefixItems?.length, 3);
      assertEquals(json.minItems, 3);
      assertEquals(json.maxItems, 3);
    });
  });

  describe("union types", () => {
    it("should convert union schema", () => {
      const schema = z.union([z.string(), z.number()]);
      const json = zodToJsonSchema(schema);

      assertExists(json.anyOf);
      assertEquals(json.anyOf?.length, 2);
      assertEquals(json.anyOf?.[0], { type: "string" });
      assertEquals(json.anyOf?.[1], { type: "number" });
    });

    it("should convert discriminated union", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), value: z.string() }),
        z.object({ type: z.literal("b"), value: z.number() }),
      ]);
      const json = zodToJsonSchema(schema);

      assertExists(json.anyOf);
      assertEquals(json.anyOf?.length, 2);
    });
  });

  describe("record types", () => {
    it("should convert record schema", () => {
      const schema = z.record(z.string(), z.number());
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "object");
      assertEquals(json.additionalProperties, { type: "number" });
    });
  });

  describe("default values", () => {
    it("should include default value in JSON schema", () => {
      const schema = z.string().default("default value");
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "string");
      assertEquals(json.default, "default value");
    });
  });

  describe("nullable types", () => {
    it("should handle nullable schema", () => {
      const schema = z.string().nullable();
      const json = zodToJsonSchema(schema);

      assertExists(json.anyOf);
      assertEquals(json.anyOf?.length, 2);
      assert(json.anyOf?.some((s) => s.type === "string"));
      assert(json.anyOf?.some((s) => s.type === "null"));
    });
  });

  describe("optional types", () => {
    it("should handle optional schema", () => {
      const schema = z.string().optional();
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "string");
    });
  });

  describe("lazy schemas", () => {
    it("should handle lazy schema", () => {
      const schema = z.lazy(() => z.string());
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "string");
    });
  });

  describe("refined/transformed schemas", () => {
    it("should handle refined schema", () => {
      const schema = z.string().refine((val) => val.length > 5);
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "string");
    });

    it("should handle transformed schema", () => {
      const schema = z.string().transform((val) => val.toUpperCase());
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "string");
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid schema", () => {
      try {
        zodToJsonSchema(null as any);
        throw new Error("Should have thrown");
      } catch (error) {
        assert(error instanceof Error);
        assert(error.message.includes("Invalid Zod schema"));
      }
    });

    it("should fallback to object for unknown types", () => {
      const schema = { _def: { typeName: "UnknownType" } } as any;
      const json = zodToJsonSchema(schema);

      assertEquals(json.type, "object");
    });
  });
});

describe("isOptionalSchema", () => {
  it("should return true for optional schema", () => {
    const schema = z.string().optional();
    assert(isOptionalSchema(schema));
  });

  it("should return false for required schema", () => {
    const schema = z.string();
    assert(!isOptionalSchema(schema));
  });

  it("should handle nested optional", () => {
    const schema = z.string().nullable().optional();
    assert(isOptionalSchema(schema));
  });
});
