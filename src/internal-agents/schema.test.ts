import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ResumeSignalSchema, RuntimeRunAgentInputSchema } from "./schema.ts";

describe("internal-agents/schema", () => {
  it("applies defaults for optional runtime collections", () => {
    const parsed = RuntimeRunAgentInputSchema.parse({
      agentId: "agent_1",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
    });

    assertEquals(parsed.tools, []);
    assertEquals(parsed.context, []);
  });

  it("rejects oversized injected tool parameters", () => {
    assertThrows(
      () =>
        RuntimeRunAgentInputSchema.parse({
          agentId: "agent_1",
          threadId: crypto.randomUUID(),
          runId: "run_1",
          messages: [],
          tools: [{
            name: "focusComponent",
            parameters: { payload: "x".repeat(16_500) },
          }],
        }),
      Error,
      "Tool parameters must be less than 16 KB",
    );
  });

  it("rejects runtime context that exceeds the total size limit", () => {
    assertThrows(
      () =>
        RuntimeRunAgentInputSchema.parse({
          agentId: "agent_1",
          threadId: crypto.randomUUID(),
          runId: "run_1",
          messages: [],
          context: Array.from({ length: 5 }, () => ({
            type: "text" as const,
            text: "x".repeat(14_000),
          })),
        }),
      Error,
      "context must be less than 64 KB total",
    );
  });

  it("defaults resume signals to non-error tool results", () => {
    assertEquals(
      ResumeSignalSchema.parse({
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
      }),
      {
        type: "tool_result",
        toolCallId: "tool_1",
        result: { ok: true },
        isError: false,
      },
    );
  });
});
