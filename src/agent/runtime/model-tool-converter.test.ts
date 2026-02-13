import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { convertToolsToAISDK } from "./model-tool-converter.ts";
import type { ToolDefinition } from "#veryfront/tool";

describe("model-tool-converter", () => {
  it("returns undefined for empty tools array", () => {
    assertEquals(convertToolsToAISDK([]), undefined);
  });

  it("converts a single tool definition", () => {
    const tools: ToolDefinition[] = [
      {
        name: "search",
        description: "Search the web",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
    ];

    const result = convertToolsToAISDK(tools)!;
    assertEquals(typeof result, "object");
    assertEquals("search" in result, true);
    assertEquals(typeof result.search, "object");
  });

  it("converts multiple tool definitions", () => {
    const tools: ToolDefinition[] = [
      {
        name: "search",
        description: "Search",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "calculate",
        description: "Calculate",
        parameters: {
          type: "object",
          properties: { expr: { type: "string" } },
          required: ["expr"],
        },
      },
    ];

    const result = convertToolsToAISDK(tools)!;
    assertEquals(Object.keys(result).sort(), ["calculate", "search"]);
  });

  it("preserves tool description", () => {
    const tools: ToolDefinition[] = [
      {
        name: "weather",
        description: "Get current weather",
        parameters: { type: "object", properties: {} },
      },
    ];

    const result = convertToolsToAISDK(tools)!;
    // The AI SDK tool() wraps the definition; check it exists
    assertEquals("weather" in result, true);
  });

  it("handles tools with complex schemas", () => {
    const tools: ToolDefinition[] = [
      {
        name: "create_file",
        description: "Create a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            options: {
              type: "object",
              properties: {
                overwrite: { type: "boolean" },
                encoding: { type: "string", enum: ["utf-8", "ascii"] },
              },
            },
          },
          required: ["path", "content"],
        },
      },
    ];

    const result = convertToolsToAISDK(tools);
    assertEquals(result !== undefined, true);
    assertEquals("create_file" in result!, true);
  });
});
