/**
 * Tool System Tests
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { beforeEach, describe, it } from "@std/testing/bdd.ts";
import { dynamicTool, executeTool, tool, toolRegistry } from "./tool.ts";
import { z } from "zod";

describe("Tool System", () => {
  beforeEach(() => {
    // Clear registry before each test
    toolRegistry.clear();
  });

  it("should create a tool", () => {
    const myTool = tool({
      description: "Test tool",
      inputSchema: z.object({
        input: z.string(),
      }),
      execute: ({ input }) => Promise.resolve({ result: input }),
    });

    assertExists(myTool);
    assertExists(myTool.id);
    assertEquals(myTool.description, "Test tool");
    assertExists(myTool.execute);
  });

  it("should execute a tool with valid input", async () => {
    const myTool = tool({
      description: "Echo tool",
      inputSchema: z.object({
        message: z.string(),
      }),
      execute: ({ message }) => Promise.resolve({ echo: message }),
    });

    const result = await myTool.execute({ message: "hello" });
    assertEquals(result, { echo: "hello" });
  });

  it("should validate tool input with Zod schema", async () => {
    const myTool = tool({
      description: "Math tool",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: ({ a, b }) => Promise.resolve({ sum: a + b }),
    });

    const result = await myTool.execute({ a: 2, b: 3 });
    assertEquals(result, { sum: 5 });
  });

  it("should throw error on invalid input", async () => {
    const myTool = tool({
      description: "Number tool",
      inputSchema: z.object({
        num: z.number(),
      }),
      execute: ({ num }) => Promise.resolve({ result: num }),
    });

    try {
      // @ts-ignore - intentionally passing wrong type
      await myTool.execute({ num: "not a number" });
      throw new Error("Should have thrown validation error");
    } catch (error) {
      assertExists(error);
      assertEquals((error as Error).message.includes("validation failed"), true);
    }
  });

  it("should register tool in registry", () => {
    const myTool = tool({
      description: "Test tool",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
    });

    toolRegistry.register("test", myTool);

    assertEquals(toolRegistry.has("test"), true);
    assertEquals(toolRegistry.get("test"), myTool);
  });

  it("should execute tool via registry", async () => {
    const myTool = tool({
      id: "calculator",
      description: "Calculate",
      inputSchema: z.object({
        operation: z.literal("add"),
        a: z.number(),
        b: z.number(),
      }),
      execute: ({ a, b }) => Promise.resolve({ result: a + b }),
    });

    toolRegistry.register("calculator", myTool);

    const result = await executeTool("calculator", {
      operation: "add",
      a: 5,
      b: 3,
    });

    assertEquals(result, { result: 8 });
  });

  it("should throw error for non-existent tool", async () => {
    try {
      await executeTool("nonexistent", {});
      throw new Error("Should have thrown");
    } catch (error) {
      assertExists(error);
      assertEquals((error as Error).message.includes("not found"), true);
    }
  });

  it("should get all tool IDs", () => {
    const tool1 = tool({
      description: "Tool 1",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
    });

    const tool2 = tool({
      description: "Tool 2",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
    });

    toolRegistry.register("tool1", tool1);
    toolRegistry.register("tool2", tool2);

    const ids = toolRegistry.getAllIds();
    assertEquals(ids.length, 2);
    assertEquals(ids.includes("tool1"), true);
    assertEquals(ids.includes("tool2"), true);
  });

  it("should support MCP configuration", () => {
    const myTool = tool({
      description: "MCP tool",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
      mcp: {
        enabled: true,
        requiresAuth: true,
      },
    });

    assertEquals(myTool.mcp?.enabled, true);
    assertEquals(myTool.mcp?.requiresAuth, true);
  });
});

describe("Dynamic Tool System", () => {
  beforeEach(() => {
    // Clear registry before each test
    toolRegistry.clear();
  });

  it("should create a dynamic tool with 'dynamic' type", () => {
    const myTool = dynamicTool({
      description: "Dynamic test tool",
      inputSchema: z.object({}),
      execute: (input) => Promise.resolve({ received: input }),
    });

    assertExists(myTool);
    assertExists(myTool.id);
    assertEquals(myTool.type, "dynamic");
    assertEquals(myTool.description, "Dynamic test tool");
    assertExists(myTool.execute);
  });

  it("should execute dynamic tool with unknown input type", async () => {
    const myTool = dynamicTool({
      description: "Echo dynamic tool",
      inputSchema: z.unknown(),
      execute: (input) => {
        // Input is unknown - cast at runtime
        const { message } = input as { message: string };
        return Promise.resolve({ echo: message });
      },
    });

    const result = await myTool.execute({ message: "hello" });
    assertEquals(result, { echo: "hello" });
  });

  it("should skip input validation for dynamic tools", async () => {
    const myTool = dynamicTool({
      description: "Permissive tool",
      inputSchema: z.object({}), // Empty schema
      execute: (input) => Promise.resolve({ received: input }),
    });

    // Dynamic tools should NOT throw on "invalid" input
    // They skip validation entirely
    const result = await myTool.execute({ anyKey: "anyValue", num: 123 });
    assertEquals(result, { received: { anyKey: "anyValue", num: 123 } });
  });

  it("should support toModelOutput transformation", async () => {
    const myTool = dynamicTool({
      description: "Tool with output transform",
      inputSchema: z.any(),
      execute: (input) => Promise.resolve({ raw: input, timestamp: Date.now() }),
      toModelOutput: (output) => {
        const { raw } = output as { raw: unknown };
        return { transformed: raw };
      },
    });

    const result = await myTool.execute({ data: "test" });
    assertEquals(result, { transformed: { data: "test" } });
  });

  it("should generate valid JSON schema from zod schema", () => {
    const myTool = dynamicTool({
      description: "Dynamic tool",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
    });

    assertExists(myTool.inputSchemaJson);
    assertEquals(myTool.inputSchemaJson?.type, "object");
    assertExists(myTool.inputSchemaJson?.properties);
  });

  it("should register dynamic tool in registry", () => {
    const myTool = dynamicTool({
      id: "dynamic-test",
      description: "Dynamic test tool",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
    });

    toolRegistry.register("dynamic-test", myTool);

    assertEquals(toolRegistry.has("dynamic-test"), true);
    const retrieved = toolRegistry.get("dynamic-test");
    assertEquals(retrieved?.type, "dynamic");
  });

  it("should execute dynamic tool via registry", async () => {
    const myTool = dynamicTool({
      id: "mcp-weather",
      description: "Get weather from MCP",
      inputSchema: z.object({}),
      execute: (input) => {
        const { location } = input as { location: string };
        return Promise.resolve({ temperature: 72, location });
      },
    });

    toolRegistry.register("mcp-weather", myTool);

    const result = await executeTool("mcp-weather", { location: "San Francisco" });
    assertEquals(result, { temperature: 72, location: "San Francisco" });
  });

  it("should support MCP configuration for dynamic tools", () => {
    const myTool = dynamicTool({
      description: "MCP dynamic tool",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({}),
      mcp: {
        enabled: true,
        requiresAuth: false,
        cachePolicy: "cache-first",
      },
    });

    assertEquals(myTool.mcp?.enabled, true);
    assertEquals(myTool.mcp?.requiresAuth, false);
    assertEquals(myTool.mcp?.cachePolicy, "cache-first");
  });

  it("should handle z.unknown() schema and accept any input", async () => {
    const myTool = dynamicTool({
      description: "Unknown input tool",
      inputSchema: z.unknown(),
      execute: (input) => Promise.resolve(input),
    });

    assertExists(myTool.inputSchemaJson);
    // Dynamic tools should work with any input regardless of schema
    const result = await myTool.execute({ any: "data", nested: { value: 123 } });
    assertEquals(result, { any: "data", nested: { value: 123 } });
  });

  it("should handle z.any() schema and accept any input", async () => {
    const myTool = dynamicTool({
      description: "Any input tool",
      inputSchema: z.any(),
      execute: (input) => Promise.resolve(input),
    });

    assertExists(myTool.inputSchemaJson);
    // Dynamic tools should work with any input regardless of schema
    const result = await myTool.execute([1, 2, 3]);
    assertEquals(result, [1, 2, 3]);
  });

  it("should differentiate from regular tool type", () => {
    const regularTool = tool({
      description: "Regular tool",
      inputSchema: z.object({ name: z.string() }),
      execute: ({ name }) => Promise.resolve({ greeting: `Hello, ${name}` }),
    });

    const dynTool = dynamicTool({
      description: "Dynamic tool",
      inputSchema: z.object({}),
      execute: (input) => Promise.resolve(input),
    });

    assertEquals(regularTool.type, "function");
    assertEquals(dynTool.type, "dynamic");
  });
});
