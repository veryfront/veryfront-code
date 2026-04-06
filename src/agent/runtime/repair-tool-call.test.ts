import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { InvalidToolInputError } from "ai";
import { repairToolCall } from "./repair-tool-call.ts";

function buildInvalidToolInputError(toolName: string, toolInput: string): InvalidToolInputError {
  return new InvalidToolInputError({
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
        providerExecuted: undefined,
        toolCallId: "tool-1",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, {
      input: JSON.stringify({ query: "Veryfront" }),
      providerExecuted: undefined,
      toolCallId: "tool-1",
      toolName: "web_search",
      type: "tool-call",
    });
  });

  it("repairs JSON string literal web_search input into the expected object shape", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("web_search", "\"Veryfront\""),
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
        input: "\"Veryfront\"",
        providerExecuted: undefined,
        toolCallId: "tool-2",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, {
      input: JSON.stringify({ query: "Veryfront" }),
      providerExecuted: undefined,
      toolCallId: "tool-2",
      toolName: "web_search",
      type: "tool-call",
    });
  });

  it("returns null for unsupported tools", async () => {
    const repaired = await repairToolCall({
      error: buildInvalidToolInputError("create_file", "README.md"),
      inputSchema: async () => ({ type: "object" }),
      messages: [],
      system: undefined,
      toolCall: {
        input: "README.md",
        providerExecuted: undefined,
        toolCallId: "tool-3",
        toolName: "create_file",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(repaired, null);
  });
});
