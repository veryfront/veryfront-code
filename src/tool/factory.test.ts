import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
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

    it("should apply toModelOutput transform", async () => {
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
  });
});
