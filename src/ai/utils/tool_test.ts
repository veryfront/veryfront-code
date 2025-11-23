/**
 * Tool System Tests
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { beforeEach, describe, it } from "@std/testing/bdd.ts";
import { executeTool, tool, toolRegistry } from "./tool.ts";
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
