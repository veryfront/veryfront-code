import "#veryfront/schemas/_test-setup.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { z } from "zod";
import { tool } from "./factory.ts";
import { toolRegistry, toolToProviderDefinition } from "./registry.ts";
import type { Tool } from "./types.ts";

describe("tool registry", () => {
  afterEach(() => {
    toolRegistry.clearAll();
  });

  it("should prefer pre-converted schemas for provider definitions", () => {
    const registeredTool = tool({
      id: "registered-tool",
      description: "desc",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => null,
    });

    assertEquals(toolToProviderDefinition(registeredTool), {
      name: "registered-tool",
      description: "desc",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    });
  });

  it("should convert schemas at runtime when a tool has no cached JSON schema", () => {
    const runtimeOnlyTool: Tool<{ enabled: boolean }, unknown> = {
      id: "runtime-tool",
      type: "function",
      description: "desc",
      inputSchema: z.object({ enabled: z.boolean() }),
      execute: async () => null,
    };

    assertEquals(toolToProviderDefinition(runtimeOnlyTool), {
      name: "runtime-tool",
      description: "desc",
      parameters: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
      },
    });
  });

  it("should return provider definitions for all registered tools", () => {
    toolRegistry.register(
      "first-tool",
      tool({
        id: "first-tool",
        description: "first",
        inputSchema: z.object({}),
        execute: async () => null,
      }),
    );
    toolRegistry.register(
      "second-tool",
      tool({
        id: "second-tool",
        description: "second",
        inputSchema: z.object({ value: z.number() }),
        execute: async () => null,
      }),
    );

    assertEquals(toolRegistry.getToolsForProvider(), [
      {
        name: "first-tool",
        description: "first",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "second-tool",
        description: "second",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
      },
    ]);
  });
});
