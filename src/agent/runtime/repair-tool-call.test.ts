import "#veryfront/schemas/_test-setup.ts";
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
    }, "raw string input must be wrapped into a query object");
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
    }, "JSON string literal input must be unwrapped into a query object");
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
    }, "numeric JSON literals must keep the raw query text");
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

    assertEquals(repaired, null, "client-executed web_search calls must not be repaired");
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

    assertEquals(repaired, null, "tools other than web_search must not be repaired");
  });

  it("returns null for errors that are not invalid-tool-input errors", async () => {
    const repaired = await repairToolCall({
      error: new Error("boom"),
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
        toolCallId: "tool-6",
        toolName: "web_search",
        type: "tool-call",
      },
      tools: {},
    });

    assertEquals(
      repaired,
      null,
      "only invalid-tool-input errors may be repaired; other failures must not fabricate a query",
    );
  });
});
