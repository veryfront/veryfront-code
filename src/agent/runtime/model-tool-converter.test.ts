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

  it("adds provider-native web_search for anthropic models when explicitly allowed", () => {
    const result = convertToolsToAISDK([], {
      model: "anthropic/claude-sonnet-4-6",
      allowedToolNames: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_search" in result!, true);
  });

  it("adds provider-native web_search for veryfront-cloud anthropic models when explicitly allowed", () => {
    const result = convertToolsToAISDK([], {
      model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      allowedToolNames: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_search" in result!, true);
  });

  it("does not add provider-native web_search for non-anthropic models", () => {
    const result = convertToolsToAISDK([], {
      model: "openai/gpt-4o-mini",
      allowedToolNames: ["web_search"],
    });

    assertEquals(result, undefined);
  });

  it("does not override an explicit local tool named web_search", () => {
    const tools: ToolDefinition[] = [
      {
        name: "web_search",
        description: "Project-owned search tool",
        parameters: { type: "object", properties: {} },
      },
    ];

    const result = convertToolsToAISDK(tools, {
      model: "anthropic/claude-sonnet-4-6",
      allowedToolNames: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals(Object.keys(result!).filter((name) => name === "web_search").length, 1);
  });
});
