import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeAgUiRuntimeMessages } from "./runtime-support.ts";

describe("agent/ag-ui-runtime-support", () => {
  it("infers tool message names from preceding assistant runtime tool calls", () => {
    const messages = normalizeAgUiRuntimeMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "harvest__list_users",
            arguments: '{"accountId":"2029314"}',
          },
        }],
      },
      {
        id: "tool-1-result",
        role: "tool",
        toolCallId: "tool-1",
        content: '{"users":[{"id":1,"name":"Ada"}]}',
      },
    ]);

    assertEquals(messages, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "harvest__list_users",
          args: { accountId: "2029314" },
        }],
      },
      {
        id: "tool-1-result",
        role: "tool",
        parts: [{
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "harvest__list_users",
          result: '{"users":[{"id":1,"name":"Ada"}]}',
        }],
      },
    ]);
  });
});
