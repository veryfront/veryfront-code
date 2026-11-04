import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { z } from "zod";
import { createZodAdapter } from "./adapter.ts";
import { zodToJsonSchema } from "./json-schema.ts";

describe("zodToJsonSchema", () => {
  it("converts null and unconstrained values accurately", () => {
    assertEquals(zodToJsonSchema(z.null()), { type: "null" });
    assertEquals(zodToJsonSchema(z.literal(null)), { const: null, type: "null" });
    assertEquals(zodToJsonSchema(z.unknown()), {});
    assertEquals(zodToJsonSchema(z.any()), {});
  });

  it("converts the output of a custom validation guard", () => {
    const guarded = z.custom<unknown>(() => true).pipe(z.string());

    assertEquals(zodToJsonSchema(guarded), { type: "string" });
  });

  it("converts the output of a transformed custom validation pipeline", () => {
    const guarded = z
      .custom<unknown>(() => true)
      .transform((value) => ({ success: true, value }))
      .refine((result) => result.success)
      .transform((result) => result.value)
      .pipe(z.string());

    assertEquals(zodToJsonSchema(guarded), { type: "string" });
  });

  it("preserves string length, pattern, and format constraints", () => {
    assertEquals(
      zodToJsonSchema(z.string().min(2).max(10).regex(/^[a-z]+$/)),
      {
        type: "string",
        minLength: 2,
        maxLength: 10,
        pattern: "^[a-z]+$",
      },
    );
    assertEquals(zodToJsonSchema(z.string().email()), {
      type: "string",
      format: "email",
    });
    assertEquals(zodToJsonSchema(z.string().url()), {
      type: "string",
      format: "uri",
    });
    assertEquals(zodToJsonSchema(z.string().uuid()), {
      type: "string",
      format: "uuid",
    });
    assertEquals(zodToJsonSchema(z.string().datetime()), {
      type: "string",
      format: "date-time",
    });
  });

  it("preserves multiple regular-expression constraints without dropping any", () => {
    assertEquals(zodToJsonSchema(z.string().regex(/[A-Z]/).regex(/[0-9]/)), {
      type: "string",
      allOf: [{ pattern: "[A-Z]" }, { pattern: "[0-9]" }],
    });
  });

  it("does not guess at regular-expression flags JSON Schema cannot encode", () => {
    assertEquals(zodToJsonSchema(z.string().regex(/value/i)), { type: "string" });
  });

  it("preserves integer and numeric range constraints", () => {
    assertEquals(zodToJsonSchema(z.number().int().min(1).max(10)), {
      type: "integer",
      minimum: 1,
      maximum: 10,
    });
    assertEquals(zodToJsonSchema(z.number().positive().lt(10)), {
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 10,
    });
    assertEquals(zodToJsonSchema(z.number().int()), {
      type: "integer",
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  });

  it("preserves array size constraints", () => {
    assertEquals(zodToJsonSchema(z.array(z.string()).min(1).max(3)), {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    });
  });

  it("preserves finite record keys and their required-key semantics", async () => {
    const adapter = createZodAdapter();
    const schema = adapter.record(
      adapter.enum(["first", "second"]),
      adapter.string(),
    );
    const jsonSchema = adapter.toJsonSchema(schema);
    const validate = adapter.compileJsonSchema?.(jsonSchema);
    if (!validate) throw new Error("Expected the built-in adapter to compile JSON Schema");

    assertEquals(jsonSchema, {
      type: "object",
      properties: {
        first: { type: "string" },
        second: { type: "string" },
      },
      required: ["first", "second"],
      additionalProperties: false,
    });
    assertEquals(schema.safeParse({ first: "a", second: "b" }).success, true);
    assertEquals((await validate({ first: "a", second: "b" })).success, true);
    assertEquals(schema.safeParse({ first: "a" }).success, false);
    assertEquals((await validate({ first: "a" })).success, false);
    assertEquals(schema.safeParse({ first: "a", second: "b", third: "c" }).success, false);
    assertEquals((await validate({ first: "a", second: "b", third: "c" })).success, false);
  });

  it("preserves defaults on union schemas", () => {
    const adapter = createZodAdapter();
    const schema = adapter.union([adapter.string(), adapter.number()]).default("fallback");

    assertEquals(adapter.toJsonSchema(schema), {
      anyOf: [{ type: "string" }, { type: "number" }],
      default: "fallback",
    });
  });

  it("preserves __proto__ as an ordinary object-schema property", () => {
    const adapter = createZodAdapter();
    const schema = adapter.object({
      ["__proto__"]: adapter.string(),
    });
    const input = JSON.parse('{"__proto__":"data"}');

    const parsed = schema.parse(input);
    const jsonSchema = adapter.toJsonSchema(schema);

    assertEquals(Object.hasOwn(parsed, "__proto__"), true);
    assertEquals((parsed as Record<string, unknown>)["__proto__"], "data");
    assertEquals(jsonSchema, {
      type: "object",
      properties: {
        ["__proto__"]: { type: "string" },
      },
      required: ["__proto__"],
    });
    assertEquals(Object.getPrototypeOf(jsonSchema.properties), Object.prototype);
  });

  it("validates declared data keys before object refinements without changing prototypes", () => {
    const adapter = createZodAdapter();
    let refinements = 0;
    const schema = adapter.object({
      ["__proto__"]: adapter.string().transform((value) => value.toUpperCase()),
    }).extend({ label: adapter.string() }).strict().superRefine((value) => {
      refinements++;
      assertEquals(value["__proto__"], "DATA");
    });
    const result = schema.parse(JSON.parse('{"__proto__":"data","label":"ok"}'));
    assertEquals(result["__proto__"], "DATA");
    assertStrictEquals(Object.getPrototypeOf(result), Object.prototype);
    assertEquals(refinements, 1);

    const invalid = schema.safeParse(JSON.parse('{"__proto__":3,"label":"ok"}'));
    assertEquals(invalid.success, false);
    if (!invalid.success) {
      assertEquals(invalid.issues.map(({ code, path }) => ({ code, path })), [
        { code: "invalid_type", path: ["__proto__"] },
      ]);
    }
    assertEquals(refinements, 1);
    assertEquals(
      schema.safeParse(JSON.parse(
        '{"__proto__":"data","label":"ok","unexpected":true}',
      )).success,
      false,
    );

    let observed: unknown;
    const refining = adapter.object({
      ["__proto__"]: adapter.string().refine(() => false, "Field refused"),
    }).superRefine((value) => {
      observed = value["__proto__"];
    });
    assertEquals(refining.safeParse(JSON.parse('{"__proto__":"data"}')).success, false);
    assertEquals(observed, "data");
  });

  it("preserves declared data keys through nested, partial and picked objects", () => {
    const adapter = createZodAdapter();
    const base = adapter.object({ ["__proto__"]: adapter.string(), label: adapter.string() });
    const nested = adapter.object({ payload: base });
    const parsed = nested.parse(JSON.parse('{"payload":{"__proto__":"data","label":"ok"}}'));
    assertEquals(parsed.payload["__proto__"], "data");
    assertStrictEquals(Object.getPrototypeOf(parsed.payload), Object.prototype);
    assertEquals(base.partial().parse({}), {});
    assertEquals(
      base.pick({ ["__proto__"]: true }).parse(JSON.parse('{"__proto__":"data"}'))[
        "__proto__"
      ],
      "data",
    );
    assertEquals(base.omit({ ["__proto__"]: true }).parse({ label: "ok" }), { label: "ok" });
  });

  it("preserves the original error when a declared data property cannot be read", () => {
    const adapter = createZodAdapter();
    const schema = adapter.object({ ["__proto__"]: adapter.string() }).superRefine((value) => {
      assertEquals(typeof value["__proto__"], "string");
    });
    const failure = new Error("Declared data read failed");
    const input = Object.defineProperty({}, "__proto__", {
      enumerable: true,
      get() {
        throw failure;
      },
    });
    assertStrictEquals(assertThrows(() => schema.parse(input)), failure);
    assertEquals(schema.parse(JSON.parse('{"__proto__":"data"}'))["__proto__"], "data");
    assertEquals(schema.safeParse(JSON.parse('{"__proto__":3}')).success, false);
  });

  it("keeps declared field validation active during reentrant first parses", () => {
    const adapter = createZodAdapter();
    let validateNested = () => {};
    const schema = adapter.object({
      label: adapter.string().refine(() => {
        validateNested();
        return true;
      }),
      ["__proto__"]: adapter.string(),
    }).superRefine((value) => {
      assertEquals(value["__proto__"], "data");
    });
    let active = false;
    validateNested = () => {
      if (active) return;
      active = true;
      try {
        assertEquals(
          schema.safeParse(JSON.parse('{"label":"nested","__proto__":3}')).success,
          false,
        );
      } finally {
        active = false;
      }
    };
    assertEquals(
      schema.parse(JSON.parse('{"label":"outer","__proto__":"data"}'))["__proto__"],
      "data",
    );
  });

  it("unwraps nullable schemas returned by lazy schemas", () => {
    const schema = z.lazy(() => z.string().nullable());

    assertEquals(zodToJsonSchema(schema), {
      anyOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("fails clearly before deep conversion can exhaust the call stack", () => {
    let schema: z.ZodTypeAny = z.string();
    for (let depth = 0; depth < 130; depth++) {
      schema = z.array(schema);
    }

    assertThrows(
      () => zodToJsonSchema(schema),
      RangeError,
      "maximum conversion depth",
    );
  });

  it("bounds schema wrapper traversal by conversion depth", () => {
    let schema: z.ZodTypeAny = z.string();
    for (let depth = 0; depth < 130; depth++) {
      schema = schema.optional();
    }

    assertThrows(
      () => zodToJsonSchema(schema),
      RangeError,
      "maximum conversion depth",
    );
  });

  it("bounds finite record-key discovery by conversion depth", () => {
    let keySchema: z.ZodTypeAny = z.literal("key");
    for (let depth = 0; depth < 130; depth++) {
      keySchema = z.union([keySchema, z.literal("key")]);
    }

    assertThrows(
      () => zodToJsonSchema(z.record(keySchema as never, z.string())),
      RangeError,
      "maximum conversion depth",
    );
  });

  it("preflights finite record-key unions against the conversion node budget", () => {
    const key = z.literal("key");
    const options = new Array(100_000).fill(key) as [
      typeof key,
      typeof key,
      ...(typeof key)[],
    ];

    assertThrows(
      () => zodToJsonSchema(z.record(z.union(options), z.string())),
      RangeError,
      "maximum conversion node count",
    );
  });

  it("counts abandoned finite-key probes against the conversion node budget", () => {
    const key = z.literal("key");
    const options: [
      typeof key,
      typeof key,
      ...(typeof key | z.ZodString)[],
    ] = [
      key,
      key,
      ...new Array<typeof key>(49_998).fill(key),
      z.string(),
    ];

    assertThrows(
      () => zodToJsonSchema(z.record(z.union(options), z.string())),
      RangeError,
      "maximum conversion node count",
    );
  });
});
