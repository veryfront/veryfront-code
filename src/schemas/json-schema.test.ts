import "./_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import {
  defineSchema,
  getEmailSchema,
  getJsonValueSchema,
  getPaginationSchema,
  getPortNumberSchema,
  getStrongPasswordSchema,
  lazySchema,
  schemaIsOptional,
  schemaToJsonSchema,
} from "./index.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

describe("JSON Schema helpers", () => {
  afterEach(() => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

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

  it("emits all JSON value primitive and container types", () => {
    assertEquals(schemaToJsonSchema(getJsonValueSchema()), {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
        { type: "array", items: {} },
        { type: "object", properties: {}, additionalProperties: true },
      ],
    });
  });

  it("preserves shared schema constraints and defaults", () => {
    assertEquals(schemaToJsonSchema(getEmailSchema()), {
      type: "string",
      maxLength: 255,
      format: "email",
    });
    assertEquals(schemaToJsonSchema(getPortNumberSchema()), {
      type: "integer",
      minimum: 1,
      maximum: 65_535,
    });
    assertEquals(schemaToJsonSchema(getStrongPasswordSchema()), {
      type: "string",
      minLength: 8,
      allOf: [
        { pattern: "[A-Z]" },
        { pattern: "[a-z]" },
        { pattern: "[0-9]" },
        { pattern: "[^A-Za-z0-9]" },
      ],
    });

    const pagination = schemaToJsonSchema(getPaginationSchema());
    assertEquals(pagination.properties?.page, {
      anyOf: [
        { type: "string", maxLength: 16, pattern: "^\\d+$" },
        {
          type: "integer",
          exclusiveMinimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      ],
      default: 1,
    });
    assertEquals(pagination.properties?.limit, {
      anyOf: [
        { type: "string", maxLength: 16, pattern: "^\\d+$" },
        { type: "integer", exclusiveMinimum: 0, maximum: 100 },
      ],
      default: 10,
    });
  });

  it("does not execute dynamic defaults during schema conversion", () => {
    let defaultCalls = 0;
    const schema = defineSchema((v) =>
      v.string().default(() => {
        defaultCalls += 1;
        return "generated";
      })
    )();

    assertEquals(schemaToJsonSchema(schema), { type: "string" });
    assertEquals(defaultCalls, 0);
    assertEquals(schema.parse(undefined), "generated");
    assertEquals(defaultCalls, 1);
  });

  it("rejects malformed adapter conversion results", () => {
    reset();
    const adapter = createZodAdapter();
    register<SchemaValidator>("SchemaValidator", {
      ...adapter,
      toJsonSchema: () => null as never,
    });

    assertThrows(
      () => schemaToJsonSchema(adapter.string()),
      TypeError,
      "must return a bounded JSON Schema object",
    );
  });

  it("returns a data-only snapshot of stateful adapter output", () => {
    reset();
    const adapter = createZodAdapter();
    let descriptorReads = 0;
    let valueReads = 0;
    const target = { type: "string" as const };
    const adapterOutput = new Proxy(target, {
      getOwnPropertyDescriptor(_target, property) {
        if (property !== "type") return undefined;
        descriptorReads += 1;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: "string",
        };
      },
      get(_target, property, receiver) {
        if (property === "type") {
          valueReads += 1;
          return () => "not-json";
        }
        return Reflect.get(_target, property, receiver);
      },
    });
    register<SchemaValidator>("SchemaValidator", {
      ...adapter,
      toJsonSchema: () => adapterOutput,
    });

    const jsonSchema = schemaToJsonSchema(adapter.string());

    assertEquals(jsonSchema, { type: "string" });
    assertEquals(jsonSchema === adapterOutput, false);
    assertEquals(descriptorReads, 1);
    assertEquals(valueReads, 0);
  });

  it("rejects malformed adapter optionality results", () => {
    reset();
    const adapter = createZodAdapter();
    register<SchemaValidator>("SchemaValidator", {
      ...adapter,
      isOptional: () => "yes" as never,
    });

    assertThrows(
      () => schemaIsOptional(adapter.string()),
      TypeError,
      "must return a boolean",
    );
  });
});
