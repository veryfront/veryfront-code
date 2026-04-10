import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { repairToolCall } from "./repair-tool-call.ts";
import { createInvalidToolInputErrorForTest } from "./runtime-tool-errors.ts";

function buildInvalidToolInputError(toolName: string, toolInput: string): unknown {
  return createInvalidToolInputErrorForTest({
    cause: new Error("Expected object, received string"),
    toolInput,
    toolName,
  });
}

describe("repair-tool-call", () => {
  it("repairs raw string web_search input into the expected object shape", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("web_search", "Veryfront"),
      inputSchema: async () => ({
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      }),
      messages: [],
      system: undefined,
      toolCall: {
        input: "Veryfront",
        providerExecuted: true,
        toolCallId: "tool-1",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, {
      input: JSON.stringify({ query: "Veryfront" }),
      providerExecuted: true,
      toolCallId: "tool-1",
      toolName: "web_search",
      type: "tool-call",
    });
  });

  it("repairs JSON string literal web_search input into the expected object shape", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("web_search", '"Veryfront"'),
      inputSchema: async () => ({
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      }),
      messages: [],
      system: undefined,
      toolCall: {
        input: '"Veryfront"',
        providerExecuted: true,
        toolCallId: "tool-2",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, {
      input: JSON.stringify({ query: "Veryfront" }),
      providerExecuted: true,
      toolCallId: "tool-2",
      toolName: "web_search",
      type: "tool-call",
    });
  });

  it("repairs numeric JSON literals by preserving the raw query text", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("web_search", "2026"),
      inputSchema: async () => ({
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      }),
      messages: [],
      system: undefined,
      toolCall: {
        input: "2026",
        providerExecuted: true,
        toolCallId: "tool-3",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, {
      input: JSON.stringify({ query: "2026" }),
      providerExecuted: true,
      toolCallId: "tool-3",
      toolName: "web_search",
      type: "tool-call",
    });
  });

  it("returns null for client-executed tools named web_search", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("web_search", "Veryfront"),
      inputSchema: async () => ({
        additionalProperties: false,
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        type: "object",
      }),
      messages: [],
      system: undefined,
      toolCall: {
        input: "Veryfront",
        providerExecuted: false,
        toolCallId: "tool-4",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, null);
  });

  it("returns null for unsupported tools", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("create_file", "README.md"),
      inputSchema: async () => ({ type: "object" }),
      messages: [],
      system: undefined,
      toolCall: {
        input: "README.md",
        providerExecuted: true,
        toolCallId: "tool-5",
        toolName: "create_file",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, null);
  });
});
