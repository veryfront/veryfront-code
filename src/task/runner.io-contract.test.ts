/**
 * Task business input contract (veryfront/veryfront-issue-inbox#2105).
 *
 * A run's business input reaches the task as `ctx.input`, separate from the execution
 * settings in `ctx.config`. When no input was submitted, `ctx.input` falls back to
 * `ctx.config`, so tasks that read business data from config keep working.
 */
import "#veryfront/schemas/_test-setup.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createInMemoryHostRuntime } from "#veryfront/platform/compat/process.ts";
import { defineSchema } from "#veryfront/schemas/define.ts";
import { schemaIdentitySha256 } from "#veryfront/schemas/schema-identity.ts";
import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";
import { type RunnableTask, runTask } from "./runner.ts";
import type { TaskContext, TaskDefinition } from "./types.ts";

function makeTask(definition: TaskDefinition): RunnableTask {
  return { id: "classify", name: "classify", definition };
}

function captureContext(): { task: RunnableTask; seen: () => Partial<TaskContext> } {
  let seen: Partial<TaskContext> = {};
  const task = makeTask({
    run: (ctx) => {
      seen = { input: ctx.input, config: ctx.config };
      return null;
    },
  });
  return { task, seen: () => seen };
}

describe("src/task/runner io contract", () => {
  it("passes submitted business input as ctx.input and keeps ctx.config", async () => {
    const { task, seen } = captureContext();

    await runTask(
      { task, config: { dry_run: true }, input: { ticket: "T-1" } },
      createInMemoryHostRuntime(),
    );

    assertEquals(seen(), { input: { ticket: "T-1" }, config: { dry_run: true } });
  });

  it("falls back to config for ctx.input when no input was submitted", async () => {
    const { task, seen } = captureContext();

    await runTask({ task, config: { ticket: "T-legacy" } }, createInMemoryHostRuntime());

    assertEquals(seen(), { input: { ticket: "T-legacy" }, config: { ticket: "T-legacy" } });
  });

  it("treats null input as no input and falls back to config", async () => {
    const { task, seen } = captureContext();

    await runTask(
      { task, config: { ticket: "T-legacy" }, input: null },
      createInMemoryHostRuntime(),
    );

    assertEquals(seen(), { input: { ticket: "T-legacy" }, config: { ticket: "T-legacy" } });
  });

  it("falls back to an empty config for ctx.input when neither input nor config was submitted", async () => {
    const { task, seen } = captureContext();

    await runTask({ task }, createInMemoryHostRuntime());

    assertEquals(seen(), { input: {}, config: {} });
  });

  for (
    const [label, value] of [
      ["an array", ["INV-7731", "Harbor Office"]],
      ["a string", "a string"],
      ["a number", 42],
      ["a boolean", false],
    ] as const
  ) {
    it(`passes ${label} input to ctx.input unchanged`, async () => {
      const { task, seen } = captureContext();

      await runTask({ task, input: value }, createInMemoryHostRuntime());

      assertEquals(seen(), { input: value, config: {} });
    });
  }
});

/**
 * Declared task schemas, warning phase (veryfront/veryfront-issue-inbox#2108).
 *
 * Only submitted `input` that violates `inputSchema` fails, before user code runs. A config-only
 * run whose config violates `inputSchema`, a return value that violates `outputSchema`, and a raw
 * schema that no validator can compile are recorded in `schemaViolation` and still complete.
 */
const ticketInputSchema = {
  type: "object",
  properties: { ticketText: { type: "string", minLength: 1 } },
  required: ["ticketText"],
  additionalProperties: false,
};
const ticketOutputSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["billing", "technical", "account", "other"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["category", "confidence"],
  additionalProperties: false,
};

function schemaTask(
  schemas: Pick<TaskDefinition, "inputSchema" | "outputSchema">,
  output: unknown = { category: "billing", confidence: 0.94 },
): { task: RunnableTask; calls: Array<Partial<TaskContext>> } {
  const calls: Array<Partial<TaskContext>> = [];
  const task = makeTask({
    ...schemas,
    run: (ctx) => {
      calls.push({ input: ctx.input, config: ctx.config });
      return output;
    },
  });
  return { task, calls };
}

describe("src/task/runner declared schemas (warning phase)", () => {
  afterEach(() => {
    reset();
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  });

  it("rejects input that violates a declared inputSchema without running the task", async () => {
    const { task, calls } = schemaTask({ inputSchema: ticketInputSchema });

    const result = await runTask({ task, input: { ticketText: 42 } }, createInMemoryHostRuntime());

    assertEquals(calls.length, 0);
    assertEquals(result.success, false);
    assertEquals(result.result, undefined);
    assertEquals(result.errorCode, "INPUT_VALIDATION_FAILED");
    assertEquals(result.errorDetail?.errors.map((error) => error.path), ["/ticketText"]);
    assertEquals(result.inputSchemaSha256, await schemaIdentitySha256(ticketInputSchema));
  });

  it("passes the parsed input to run() and keeps the submitted input", async () => {
    const inputSchema = defineSchema((v) =>
      v.object({ ticketText: v.string(), priority: v.string().default("normal") })
    )();
    const { task, calls } = schemaTask({ inputSchema });
    const submitted = { ticketText: "Refund INV-7731" };

    const result = await runTask({ task, input: submitted }, createInMemoryHostRuntime());

    assertEquals(result.success, true);
    assertEquals(calls[0]?.input, { ticketText: "Refund INV-7731", priority: "normal" });
    assertEquals(submitted, { ticketText: "Refund INV-7731" });
    assertEquals(result.schemaViolation, null);
  });

  it("records, but does not reject, config that violates a declared inputSchema", async () => {
    const { task, calls } = schemaTask({ inputSchema: ticketInputSchema });
    const config = { ticketText: 42 };

    const result = await runTask({ task, config }, createInMemoryHostRuntime());

    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.input, config);
    assertEquals(result.success, true);
    assertEquals(result.schemaViolation?.phase, "input");
    assertEquals(result.schemaViolation?.reason, "invalid");
    assertEquals(
      result.schemaViolation?.schema_sha256,
      await schemaIdentitySha256(ticketInputSchema),
    );
    assertEquals(result.schemaViolation?.errors.map((error) => error.path), ["/ticketText"]);
  });

  it("records, but does not fail, a return value that violates a declared outputSchema", async () => {
    const returned = { category: "billing", confidence: "high" };
    const { task } = schemaTask({ outputSchema: ticketOutputSchema }, returned);

    const result = await runTask({ task, input: { ticketText: "x" } }, createInMemoryHostRuntime());

    assertEquals(result.success, true);
    assertEquals(result.result, returned);
    assertEquals(result.schemaViolation?.phase, "output");
    assertEquals(result.schemaViolation?.reason, "invalid");
    assertEquals(
      result.schemaViolation?.schema_sha256,
      await schemaIdentitySha256(ticketOutputSchema),
    );
    assertEquals(result.schemaViolation?.errors.map((error) => error.path), ["/confidence"]);
    assertMatch(result.schemaViolation?.detected_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
  });

  it("records an output violation even when the task replaced Array slice and map", async () => {
    const originalSlice = Reflect.getOwnPropertyDescriptor(Array.prototype, "slice")!;
    const originalMap = Reflect.getOwnPropertyDescriptor(Array.prototype, "map")!;
    const task = makeTask({
      outputSchema: ticketOutputSchema,
      run: () => {
        Reflect.set(Array.prototype, "slice", () => {
          throw new Error("replaced Array.prototype.slice");
        });
        Reflect.set(Array.prototype, "map", () => {
          throw new Error("replaced Array.prototype.map");
        });
        return { category: "billing", confidence: "high" };
      },
    });

    let result: Awaited<ReturnType<typeof runTask>>;
    try {
      result = await runTask({ task, input: { ticketText: "x" } }, createInMemoryHostRuntime());
    } finally {
      Reflect.defineProperty(Array.prototype, "slice", originalSlice);
      Reflect.defineProperty(Array.prototype, "map", originalMap);
    }

    // The warning phase holds: the run completes with the returned value and a recorded mismatch.
    assertEquals(result.success, true);
    assertEquals(result.result, { category: "billing", confidence: "high" });
    assertEquals(result.schemaViolation?.phase, "output");
  });

  it("returns the validated output with the sha256 identity of the canonical output schema", async () => {
    const { task } = schemaTask({
      inputSchema: ticketInputSchema,
      outputSchema: ticketOutputSchema,
    });

    const result = await runTask(
      { task, input: { ticketText: "Refund INV-7731" } },
      createInMemoryHostRuntime(),
    );

    assertEquals(result.success, true);
    assertEquals(result.result, { category: "billing", confidence: 0.94 });
    assertEquals(result.outputSchemaSha256, await schemaIdentitySha256(ticketOutputSchema));
    assertMatch(result.outputSchemaSha256 ?? "", /^[0-9a-f]{64}$/);
    assertEquals(result.inputSchemaSha256, await schemaIdentitySha256(ticketInputSchema));
    assertEquals(result.schemaViolation, null);
  });

  it("validates the value run() returned, before any output filtering on reads", async () => {
    const outputSchema = defineSchema((v) => v.object({ category: v.string() }))();
    const { task } = schemaTask({ outputSchema }, {
      category: "billing",
      internalNote: "kept",
    });

    const result = await runTask({ task }, createInMemoryHostRuntime());

    // The parsed value is what the run stores; the schema strips unknown keys.
    assertEquals(result.result, { category: "billing" });
    assertEquals(result.schemaViolation, null);
  });

  it("reports a raw schema no validator can compile as unenforced, never as enforced", async () => {
    reset();
    const { compileJsonSchema: _unsupported, ...legacyAdapter } = createZodAdapter();
    register<SchemaValidator>("SchemaValidator", legacyAdapter);
    const returned = { category: "billing", confidence: "high" };
    const { task } = schemaTask({ outputSchema: ticketOutputSchema }, returned);

    const result = await runTask({ task }, createInMemoryHostRuntime());

    assertEquals(result.success, true);
    assertEquals(result.result, returned);
    assertEquals(result.schemaViolation?.phase, "output");
    assertEquals(result.schemaViolation?.reason, "schema_uncompilable");
    assertEquals(result.schemaViolation?.errors, []);
  });

  for (
    const [variant, schemas] of [
      ["neither schema", {}],
      ["an input schema only", { inputSchema: ticketInputSchema }],
      ["an output schema only", { outputSchema: ticketOutputSchema }],
      ["both schemas", { inputSchema: ticketInputSchema, outputSchema: ticketOutputSchema }],
    ] as const
  ) {
    it(`runs a valid call for a task with ${variant} and records no violation`, async () => {
      const { task, calls } = schemaTask(schemas);

      const result = await runTask(
        { task, input: { ticketText: "Refund INV-7731" } },
        createInMemoryHostRuntime(),
      );

      assertEquals(calls.length, 1);
      assertEquals(result.success, true);
      assertEquals(result.result, { category: "billing", confidence: 0.94 });
      assertEquals(result.schemaViolation, null);
      assertEquals(
        result.inputSchemaSha256,
        "inputSchema" in schemas ? await schemaIdentitySha256(ticketInputSchema) : null,
      );
      assertEquals(
        result.outputSchemaSha256,
        "outputSchema" in schemas ? await schemaIdentitySha256(ticketOutputSchema) : null,
      );
    });
  }

  it("keeps a schema-less task exactly as before for any input and output", async () => {
    const { task, calls } = schemaTask({}, "anything");

    const result = await runTask(
      { task, input: 42, config: { a: 1 } },
      createInMemoryHostRuntime(),
    );

    assertEquals(calls[0]?.input, 42);
    assertEquals(result.result, "anything");
    assertEquals(result.schemaViolation, null);
    assertEquals(result.errorCode, undefined);
  });
});
