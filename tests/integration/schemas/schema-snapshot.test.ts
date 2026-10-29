import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import {
  canonicalJsonSchema,
  captureRunSchemaValidation,
  schemaIdentitySha256,
  serializeCapturedRunSchemaPair,
  snapshotRunSchemaPair,
} from "#veryfront/schemas/schema-identity.ts";

describe("paired run schema snapshot", () => {
  it("pins raw documents and callable validators while retaining transformations", async () => {
    const raw = { type: "string" };
    const pinRaw = captureRunSchemaValidation(raw);
    const rawPair = await snapshotRunSchemaPair({ inputSchema: raw });
    if (rawPair.state !== "captured") throw new Error("expected captured pair");
    raw.type = "number";
    assertEquals(pinRaw(rawPair.input), { type: "string" });
    const schema = createZodAdapter().string().transform((value) => value.toUpperCase());
    const pinCallable = captureRunSchemaValidation(schema);
    const pair = await snapshotRunSchemaPair({ inputSchema: schema });
    if (pair.state !== "captured") throw new Error("expected captured pair");
    schema.safeParse = () => ({ success: true, data: "replacement" });
    const pinned = pinCallable(pair.input);
    assertEquals(pinned.safeParse("hello"), { success: true, data: "HELLO" });
    assertEquals(pinned.parse("world"), "WORLD");
  });

  it("distinguishes observed absence from failed conversion", async () => {
    assertEquals(await snapshotRunSchemaPair({}), {
      state: "captured",
      version: 1,
      input: null,
      output: null,
    });
    assertEquals(await snapshotRunSchemaPair({ inputSchema: [] }), { state: "unknown" });
    assertEquals(await snapshotRunSchemaPair({ outputSchema: () => ({ type: "string" }) }), {
      state: "unknown",
    });
  });

  it("preserves boolean documents and shared canonical hashes", async () => {
    assertEquals(canonicalJsonSchema(false), "false");
    assertEquals(
      await schemaIdentitySha256(true),
      "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
    );
    assertEquals(await snapshotRunSchemaPair({ inputSchema: true, outputSchema: false }), {
      state: "captured",
      version: 1,
      input: {
        schema: true,
        sha256: "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b",
      },
      output: {
        schema: false,
        sha256: "fcbcf165908dd18a9e49f7ff27810176db8e9f63b4352213741664245224f8aa",
      },
    });
  });

  it("reads each definition declaration once and detaches before awaiting hashes", async () => {
    let reads = 0;
    const schema = { type: "string" };
    const pending = snapshotRunSchemaPair({
      get inputSchema() {
        reads++;
        return schema;
      },
      get outputSchema() {
        reads++;
        return { enum: ["b", "a"] };
      },
    });
    schema.type = "number";
    const result = await pending;
    assertEquals(reads, 2);
    assertEquals(result.state, "captured");
    if (result.state === "captured") assertEquals(result.input?.schema, { type: "string" });
  });

  it("rejects accessors, cycles, foreign prototypes, and over-budget declarations", async () => {
    let accesses = 0;
    const accessor = {
      get type() {
        accesses++;
        return "string";
      },
    };
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (
      const inputSchema of [accessor, cycle, new Date(), { title: "x".repeat(1024 * 1024 + 1) }]
    ) {
      assertEquals(await snapshotRunSchemaPair({ inputSchema }), { state: "unknown" });
    }
    assertEquals(accesses, 0);
  });

  it("retains own __proto__ keys without invoking prototype toJSON", async () => {
    const inputSchema: unknown = JSON.parse(
      '{"properties":{"__proto__":{"type":"string"}},"type":"object"}',
    );
    const result = await snapshotRunSchemaPair({ inputSchema });
    assertEquals(result.state, "captured");
    if (result.state === "captured") {
      assertEquals(result.input?.schema, inputSchema);
      assertEquals(result.output, null);
    }
  });
  it("converts each callable contract once and hashes its detached adapter result", async () => {
    reset();
    const adapter = createZodAdapter();
    let conversions = 0;
    register<SchemaValidator>("SchemaValidator", {
      ...adapter,
      toJsonSchema: () => {
        conversions++;
        return { type: conversions === 1 ? "string" : "number" };
      },
    });
    try {
      const result = await snapshotRunSchemaPair({
        inputSchema: adapter.string(),
        outputSchema: adapter.number(),
      });
      assertEquals(conversions, 2);
      if (result.state !== "captured") throw new Error("Expected captured pair");
      assertEquals(result.input?.schema, { type: "string" });
      assertEquals(result.output?.schema, { type: "number" });
    } finally {
      reset();
      register<SchemaValidator>("SchemaValidator", adapter);
    }
  });

  it("uses the pinned object identity beside a boolean output", async () => {
    const result = await snapshotRunSchemaPair({
      inputSchema: {
        type: "object",
        required: ["ticketText"],
        properties: { ticketText: { minLength: 1, type: "string" } },
        additionalProperties: false,
      },
      outputSchema: false,
    });
    if (result.state !== "captured") throw new Error("Expected captured pair");
    assertEquals(
      result.input?.sha256,
      "065cc2349686aff1ca583517a1039f86d207793ed9873ba1ec0505ec1f3bbe03",
    );
  });

  it("rejects existing depth, node, key and serialized-size ceilings", async () => {
    let deep: unknown = true;
    for (let i = 0; i < 130; i++) deep = { not: deep };
    const declarations = [deep, { enum: Array(100_001).fill(0) }, {
      ["x".repeat(16 * 1024 + 1)]: true,
    }, { enum: Array(5).fill("x".repeat(1024 * 1024 - 1)) }];
    for (const inputSchema of declarations) {
      assertEquals(await snapshotRunSchemaPair({ inputSchema }), { state: "unknown" });
    }
  });
  it("does not invoke a project-installed Object prototype serialization hook", async () => {
    let calls = 0;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value: () => {
        calls++;
        return "forged";
      },
    });
    let result;
    let serialized: string | undefined;
    try {
      result = await snapshotRunSchemaPair({ inputSchema: { type: "string" } });
      if (result.state === "captured") serialized = serializeCapturedRunSchemaPair(result);
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "toJSON", previous);
      else Reflect.deleteProperty(Object.prototype, "toJSON");
    }
    assertEquals(calls, 0);
    assertEquals(result.state, "captured");
    if (serialized === undefined) throw new Error("Expected serialized captured pair");
    assertEquals(JSON.parse(serialized), result);
  });
  it("sorts numeric-looking object keys lexically like the API canonical algorithm", async () => {
    const result = await snapshotRunSchemaPair({
      inputSchema: { properties: { "10": {}, "2": {} } },
    });
    if (result.state !== "captured") throw new Error("Expected captured pair");
    assertEquals(
      result.input?.sha256,
      "2ef32fe499fee0e8c29ee2251161b1576b8fdde7827f0b06652d22547955f4eb",
    );
  });
});
