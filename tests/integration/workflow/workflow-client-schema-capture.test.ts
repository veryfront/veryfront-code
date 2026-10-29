import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import {
  captureRunSchemaValidation,
  snapshotRunSchemaPair,
} from "#veryfront/schemas/schema-identity.ts";
import { workflow } from "#veryfront/workflow/dsl/workflow.ts";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { captureWorkflowDefinition } from "#veryfront/workflow/executor/workflow-definition-snapshot.ts";
import { MemoryBackend } from "#veryfront/workflow/backends/memory.ts";
import { createWorkflowClient } from "#veryfront/workflow/api/workflow-client.ts";

describe("workflow captured schema execution", () => {
  it("converts once per host-captured side after discovery and preserves callable transforms through registration", async () => {
    const adapter = createZodAdapter();
    let conversions = 0;
    reset();
    register<SchemaValidator>("SchemaValidator", {
      ...adapter,
      toJsonSchema: () => {
        conversions++;
        return { type: "string" };
      },
    });
    const backend = new MemoryBackend();
    const client = createWorkflowClient({ backend });
    try {
      const inputSchema = adapter.string().transform((value) => value.toUpperCase());
      const outputSchema = adapter.string().transform((value) => `${value}!`);
      const discovered = workflow({
        id: "captured-schema-transform",
        inputSchema,
        outputSchema,
        steps: [{
          id: "finish",
          config: {
            type: "step",
            tool: {
              id: "finish",
              type: "function",
              description: "Finish the local schema regression workflow",
              inputSchema: adapter.object({}),
              execute: () => Promise.resolve({}),
            },
          },
        }],
        output: (context) => {
          if (typeof context.input !== "string") throw new Error("Expected transformed input");
          return context.input;
        },
      });
      const discoveryConversions = conversions;
      assertEquals(discoveryConversions, 1);
      const definition = captureWorkflowDefinition(discovered.definition);
      const pinInput = captureRunSchemaValidation(definition.inputSchema);
      const pinOutput = captureRunSchemaValidation(definition.outputSchema);
      const pair = await snapshotRunSchemaPair(definition);
      if (pair.state !== "captured") throw new Error("Expected captured schemas");
      assertEquals(conversions, discoveryConversions + 2);
      const pinned = {
        ...definition,
        inputSchema: pinInput(pair.input),
        outputSchema: pinOutput(pair.output),
      };

      // Simulate authored work while the host awaits the persistence acknowledgment.
      await Promise.resolve();
      Object.defineProperties(inputSchema, {
        safeParse: {
          value: () => {
            throw new Error("Replacement input validator ran");
          },
        },
        parse: {
          value: () => {
            throw new Error("Replacement input parser ran");
          },
        },
      });
      Object.defineProperties(outputSchema, {
        safeParse: {
          value: () => {
            throw new Error("Replacement output validator ran");
          },
        },
        parse: {
          value: () => {
            throw new Error("Replacement output parser ran");
          },
        },
      });
      client.register(pinned);
      assertEquals(conversions, discoveryConversions + 2);
      const handle = await client.start(discovered.id, "hello");
      await handle.settled();
      const run = await backend.getRun(handle.runId);
      assertEquals(run?.status, "completed");
      assertEquals(run?.output, "HELLO!");
      assertEquals(conversions, discoveryConversions + 2);
      assertEquals(pair.input?.schema, { type: "string" });
      assertEquals(pair.output?.schema, { type: "string" });
    } finally {
      await client.destroy();
      workflowRegistry.clear();
      reset();
      register<SchemaValidator>("SchemaValidator", adapter);
    }
  });

  it("uses the captured raw document after mutation during acknowledgment", async () => {
    const declaration = { type: "string", minLength: 2 };
    const pin = captureRunSchemaValidation(declaration);
    const pair = await snapshotRunSchemaPair({ inputSchema: declaration });
    if (pair.state !== "captured") throw new Error("Expected captured schemas");
    await Promise.resolve();
    declaration.type = "number";
    declaration.minLength = 100;
    assertEquals(pin(pair.input), { type: "string", minLength: 2 });
    assertEquals(pair.input?.schema, { type: "string", minLength: 2 });
  });
});
