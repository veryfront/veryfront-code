import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { z } from "zod";
import { dynamicTool, tool } from "./factory.ts";

describe("tool factory", () => {
  describe("tool()", () => {
    it("should create a tool with explicit id", () => {
      const t = tool({
        id: "my-tool",
        description: "A test tool",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => "result",
      });
      assertEquals(t.id, "my-tool");
      assertEquals(t.type, "function");
      assertEquals(t.description, "A test tool");
    });

    it("should auto-generate id when not provided", () => {
      const t = tool({
        description: "auto-id",
        inputSchema: z.object({}),
        execute: async () => null,
      });
      assertStringIncludes(t.id, "tool_");
      assertEquals(t.__veryfrontGeneratedId, t.id);
    });

    it("should not mark explicit ids that happen to match the generated-id pattern", () => {
      const t = tool({
        id: "tool_2024_01",
        description: "explicit generated-looking id",
        inputSchema: z.object({}),
        execute: async () => null,
      });
      assertEquals(t.id, "tool_2024_01");
      assertEquals(t.__veryfrontGeneratedId, undefined);
    });

    it("should preserve an explicit id assigned after creation", () => {
      const generated = tool({
        description: "auto-id",
        inputSchema: z.object({}),
        execute: async () => null,
      });
      const overridden = { ...generated, id: "my-tool" };
      assertEquals(overridden.id, "my-tool");
      assertStringIncludes(generated.id, "tool_");
      assertEquals(overridden.__veryfrontGeneratedId, generated.id);
    });

    it("should convert zod schema to JSON schema", () => {
      const t = tool({
        id: "schema-test",
        description: "desc",
        inputSchema: z.object({
          name: z.string(),
          age: z.number(),
        }),
        execute: async () => null,
      });
      assertEquals(t.inputSchemaJson?.type, "object");
      assertEquals(t.inputSchemaJson?.properties?.name, { type: "string" });
      assertEquals(t.inputSchemaJson?.properties?.age, { type: "number" });
      assertEquals(t.inputSchemaJson?.required?.includes("name"), true);
      assertEquals(t.inputSchemaJson?.required?.includes("age"), true);
    });

    it("should introspect schema-like objects by shape", () => {
      const t = tool({
        id: "shape-test",
        description: "desc",
        inputSchema: {
          _def: {
            shape: {
              name: {},
              age: {},
            },
          },
        } as unknown as z.ZodSchema<unknown>,
        execute: async () => null,
      });
      assertEquals(t.inputSchemaJson, {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "string" },
        },
        required: ["name", "age"],
      });
    });

    it("should reject invalid unknown schemas when permissive fallback is disabled", () => {
      assertThrows(
        () =>
          tool({
            id: "invalid-schema",
            description: "desc",
            inputSchema: {} as z.ZodSchema<unknown>,
            execute: async () => null,
          }),
        Error,
        "input schema is not a valid Zod schema",
      );
    });

    it("should fall back to permissive schema with allowUnknownSchema", () => {
      const t = tool({
        id: "permissive-tool",
        description: "desc",
        inputSchema: {} as z.ZodSchema<unknown>,
        execute: async () => null,
        allowUnknownSchema: true,
      });
      assertEquals(t.inputSchemaJson?.type, "object");
      assertEquals(t.inputSchemaJson?.additionalProperties, true);
    });

    it("should preserve mcp config", () => {
      const t = tool({
        id: "mcp-tool",
        description: "desc",
        inputSchema: z.object({}),
        execute: async () => null,
        mcp: { enabled: true, requiresAuth: false, cachePolicy: "cache" },
      });
      assertEquals(t.mcp?.enabled, true);
      assertEquals(t.mcp?.cachePolicy, "cache");
    });
  });

  describe("tool execute()", () => {
    it("should validate input and execute", async () => {
      const t = tool({
        id: "exec-test",
        description: "desc",
        inputSchema: z.object({ value: z.string() }),
        execute: async ({ value }) => `Got: ${value}`,
      });
      const result = await t.execute({ value: "hello" });
      assertEquals(result, "Got: hello");
    });

    it("should throw on invalid input", async () => {
      const t = tool({
        id: "validate-test",
        description: "desc",
        inputSchema: z.object({ value: z.string() }),
        execute: async () => "ok",
      });
      await assertRejects(
        () => t.execute({ value: 123 } as unknown as { value: string }),
        Error,
        "input validation failed",
      );
    });

    it("should pass execution context to handler", async () => {
      let receivedCtx: unknown;
      const t = tool({
        id: "ctx-test",
        description: "desc",
        inputSchema: z.object({}),
        execute: async (_input, ctx) => {
          receivedCtx = ctx;
          return null;
        },
      });
      const ctx = { agentId: "agent-1", projectId: "proj-1" };
      await t.execute({}, ctx);
      assertEquals((receivedCtx as Record<string, unknown>).agentId, "agent-1");
    });

    it("should support sync execute functions", async () => {
      const t = tool({
        id: "sync-exec",
        description: "desc",
        inputSchema: z.object({ x: z.number() }),
        execute: ({ x }) => x * 2,
      });
      const result = await t.execute({ x: 5 });
      assertEquals(result, 10);
    });
  });

  describe("dynamicTool()", () => {
    it("should create a dynamic tool with permissive schema", () => {
      const t = dynamicTool({
        id: "dynamic",
        description: "A dynamic tool",
        inputSchema: {},
        execute: async () => "done",
      });
      assertEquals(t.id, "dynamic");
      assertEquals(t.type, "dynamic");
      assertEquals(t.inputSchemaJson?.additionalProperties, true);
    });

    it("should apply toModelOutput transform in execute return value", async () => {
      const t = dynamicTool({
        id: "transform",
        description: "desc",
        inputSchema: {},
        execute: async () => ({ raw: "data" }),
        toModelOutput: (output) => `transformed: ${JSON.stringify(output)}`,
      });
      const result = await t.execute({});
      assertEquals(result, 'transformed: {"raw":"data"}');
    });

    it("should pass through output when no toModelOutput", async () => {
      const t = dynamicTool({
        id: "passthrough",
        description: "desc",
        inputSchema: {},
        execute: async () => ({ value: 42 }),
      });
      const result = await t.execute({});
      assertEquals(result, { value: 42 });
    });

    it("should auto-generate id when not provided", () => {
      const t = dynamicTool({
        description: "auto-id",
        inputSchema: {},
        execute: async () => null,
      });
      assertStringIncludes(t.id, "tool_");
    });

    it("should preserve an explicit JSON schema override", () => {
      const t = dynamicTool({
        id: "remote-dynamic",
        description: "Remote dynamic tool",
        inputSchema: z.object({}).passthrough(),
        inputSchemaJson: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        execute: async () => null,
      });
      assertEquals(t.inputSchemaJson, {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      });
    });
  });

  describe("dynamicTool input validation", () => {
    it("should validate input with Zod schema", async () => {
      const t = dynamicTool({
        id: "zod-validate",
        description: "desc",
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => input,
      });
      const result = await t.execute({ query: "test" });
      assertEquals(result, { query: "test" });
    });

    it("should reject invalid input when Zod schema is provided", async () => {
      const t = dynamicTool({
        id: "zod-reject",
        description: "desc",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => "ok",
      });
      await assertRejects(
        () => t.execute({ query: 123 }),
        Error,
      );
    });

    it("should accept valid object input without Zod schema", async () => {
      const t = dynamicTool({
        id: "no-schema-obj",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      const result = await t.execute({ foo: "bar" });
      assertEquals(result, { foo: "bar" });
    });

    it("should reject null input without schema", async () => {
      const t = dynamicTool({
        id: "no-schema-null",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      await assertRejects(
        () => t.execute(null),
        Error,
        "input must be a non-null object",
      );
    });

    it("should coerce undefined input to empty object for zero-input tools", async () => {
      const t = dynamicTool({
        id: "no-schema-undef",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      const result = await t.execute(undefined);
      assertEquals(result, {});
    });

    it("should reject primitive input without schema", async () => {
      const t = dynamicTool({
        id: "no-schema-prim",
        description: "desc",
        inputSchema: {},
        execute: async (input) => input,
      });
      await assertRejects(
        () => t.execute("string-input"),
        Error,
        "input must be a non-null object",
      );
    });
  });
});
