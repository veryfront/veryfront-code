import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { z } from "zod";
import { tool } from "./factory.ts";
import { toolRegistry } from "./registry.ts";
import { executeTool } from "./executor.ts";

describe("executeTool", () => {
  afterEach(() => {
    toolRegistry.clearAll();
  });

  it("should execute a registered tool", async () => {
    const t = tool({
      id: "greet",
      description: "Greet someone",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => `Hello, ${name}!`,
    });
    toolRegistry.register("greet", t);

    const result = await executeTool("greet", { name: "World" });
    assertEquals(result, "Hello, World!");
  });

  it("should pass context to tool execution", async () => {
    let receivedContext: unknown;
    const t = tool({
      id: "ctx-tool",
      description: "Context tool",
      inputSchema: z.object({}),
      execute: async (_input, ctx) => {
        receivedContext = ctx;
        return null;
      },
    });
    toolRegistry.register("ctx-tool", t);

    await executeTool("ctx-tool", {}, { agentId: "test-agent" });
    assertEquals((receivedContext as Record<string, unknown>).agentId, "test-agent");
  });

  it("should throw when tool not found", async () => {
    await assertRejects(
      async () => await executeTool("nonexistent", {}),
      Error,
      'Tool "nonexistent" not found',
    );
  });
});
