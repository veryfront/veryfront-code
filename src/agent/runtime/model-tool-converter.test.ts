import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ToolDefinition } from "#veryfront/tool";
import { convertToolsToRuntimeTools } from "./model-tool-converter.ts";

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsKey(item, key));
  }
  return Object.values(value).some((item) => containsKey(item, key));
}

function getRuntimeToolSchema(tool: unknown): unknown {
  if (!tool || typeof tool !== "object" || !("inputSchema" in tool)) return undefined;
  const inputSchema = (tool as { inputSchema?: unknown }).inputSchema;
  if (!inputSchema || typeof inputSchema !== "object" || !("jsonSchema" in inputSchema)) {
    return undefined;
  }
  return (inputSchema as { jsonSchema?: unknown }).jsonSchema;
}

describe("model-tool-converter", () => {
  it("mirrors JSON schema fields on runtime schema wrappers for provider compatibility", () => {
    const result = convertToolsToRuntimeTools([
      {
        name: "outlook__search_emails",
        description: "Search emails",
        parameters: {
          type: "object",
          properties: {
            "$search": { type: "string" },
          },
          required: ["$search"],
        },
      },
    ], { model: "veryfront-cloud/anthropic/claude-opus-4-6" })!;

    const inputSchema =
      (result.outlook__search_emails as { inputSchema: Record<string, unknown> }).inputSchema;
    assertEquals(inputSchema.type, "object");
    assertEquals(inputSchema.jsonSchema, getRuntimeToolSchema(result.outlook__search_emails));
  });

  it("returns undefined for empty tools array", () => {
    assertEquals(convertToolsToRuntimeTools([]), undefined);
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

    const result = convertToolsToRuntimeTools(tools)!;
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

    const result = convertToolsToRuntimeTools(tools)!;
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

    const result = convertToolsToRuntimeTools(tools)!;
    // The runtime tool entry should preserve the execute handler.
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

    const result = convertToolsToRuntimeTools(tools);
    assertEquals(result !== undefined, true);
    assertEquals("create_file" in result!, true);
  });

  it("adds provider-native web_search for anthropic models when explicitly configured", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "anthropic/claude-sonnet-4-6",
      providerTools: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_search" in result!, true);
  });

  it("adds provider-native web_search for veryfront-cloud anthropic models when explicitly configured", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      providerTools: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_search" in result!, true);
  });

  it("adds provider-native web_fetch for anthropic models when explicitly configured", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "anthropic/claude-sonnet-4-6",
      providerTools: ["web_fetch"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_fetch" in result!, true);
  });

  it("adds provider-native web_fetch for veryfront-cloud anthropic models when explicitly configured", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "veryfront-cloud/anthropic/claude-sonnet-4-6",
      providerTools: ["web_fetch"],
    });

    assertEquals(result !== undefined, true);
    assertEquals("web_fetch" in result!, true);
  });

  it("does not add provider-native web_search for non-anthropic models", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "openai/gpt-4o-mini",
      providerTools: ["web_search"],
    });

    assertEquals(result, undefined);
  });

  it("does not add provider-native web_fetch for non-anthropic models", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "openai/gpt-4o-mini",
      providerTools: ["web_fetch"],
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

    const result = convertToolsToRuntimeTools(tools, {
      model: "anthropic/claude-sonnet-4-6",
      providerTools: ["web_search"],
    });

    assertEquals(result !== undefined, true);
    assertEquals(Object.keys(result!).filter((name) => name === "web_search").length, 1);
  });

  it("does not add provider-native web_search from remote tool allowlists", () => {
    const result = convertToolsToRuntimeTools([], {
      model: "anthropic/claude-sonnet-4-6",
      // @ts-expect-error allowedToolNames was intentionally removed from the
      // converter API so remote policies cannot enable provider-native tools.
      allowedToolNames: ["web_search"],
    });

    assertEquals(result, undefined);
  });

  it("caps OpenAI-compatible runtime tools to the provider limit", () => {
    const tools: ToolDefinition[] = Array.from({ length: 150 }, (_, index) => ({
      name: `tool_${index}`,
      description: `Tool ${index}`,
      parameters: { type: "object", properties: {} },
    }));

    const result = convertToolsToRuntimeTools(tools, {
      model: "veryfront-cloud/openai/gpt-5.2",
    });

    assertEquals(Object.keys(result ?? {}).length, 128);
    assertEquals("tool_0" in result!, true);
    assertEquals("tool_127" in result!, true);
    assertEquals("tool_128" in result!, false);
  });

  it("sanitizes Google-compatible runtime tool schemas", () => {
    const result = convertToolsToRuntimeTools([
      {
        name: "choose_kind",
        description: "Choose a kind",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "file", default: "file" },
          },
        },
      },
    ] as never, {
      model: "veryfront-cloud/google-ai-studio/gemini-2.5-flash",
    });

    const schema = getRuntimeToolSchema(result?.choose_kind);

    assertEquals(containsKey(schema, "const"), false);
    assertEquals(containsKey(schema, "default"), false);
    assertEquals(containsKey(schema, "additionalProperties"), false);
    assertEquals(
      (schema as { properties?: { kind?: { enum?: unknown[] } } }).properties?.kind?.enum,
      [
        "file",
      ],
    );
  });
});
