import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { AgUiRuntimeRequestSchema } from "./index.ts";

describe("agent/runtime-ag-ui-contract", () => {
  it("exports the canonical runtime AG-UI request schema from veryfront/agent", () => {
    const parsed = AgUiRuntimeRequestSchema.parse({
      threadId: crypto.randomUUID(),
      runId: "run_1",
      parentRunId: "run_parent",
      state: { phase: "draft" },
      messages: [
        {
          id: "sys_1",
          role: "system",
          content: "You are helpful",
        },
        {
          id: "user_1",
          role: "user",
          content: "Hello",
        },
        {
          id: "assistant_1",
          role: "assistant",
          content: "Working on it",
          toolCalls: [{
            id: "tool_1",
            type: "function",
            function: {
              name: "search_docs",
              arguments: JSON.stringify({ query: "ag-ui" }),
            },
          }],
        },
      ],
      context: [{
        description: "Current file",
        value: "src/main.ts",
      }],
    });

    assertEquals(parsed.parentRunId, "run_parent");
    assertEquals(parsed.state, { phase: "draft" });
    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, [{ description: "Current file", value: "src/main.ts" }]);
  });
});
