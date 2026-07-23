import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "./factory.ts";
import { toolRegistry } from "./registry.ts";
import { executeTool } from "./executor.ts";
import type { Tool } from "./types.ts";

describe("executeTool", () => {
  afterEach(() => {
    toolRegistry.clearAll();
  });

  it("should execute a registered tool", async () => {
    const t = tool({
      id: "greet",
      description: "Greet someone",
      inputSchema: defineSchema((v) => v.object({ name: v.string() }))(),
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
      inputSchema: defineSchema((v) => v.object({}))(),
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

  it("should reject an already-aborted execution before calling hand-authored tools", async () => {
    let executed = false;
    const registeredTool: Tool = {
      id: "hand-authored",
      type: "function",
      description: "Hand-authored tool",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => {
        executed = true;
      },
    };
    toolRegistry.register(registeredTool.id, registeredTool);
    const controller = new AbortController();
    controller.abort(new Error("execution canceled"));

    await assertRejects(
      async () => await executeTool(registeredTool.id, {}, { abortSignal: controller.signal }),
      Error,
      "execution canceled",
    );
    assertEquals(executed, false);
  });
});
