import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RuntimeAgentRunInvocationSchema } from "./agent-invocation-contract.ts";

describe("agent/runtime-agent-invocation-contract consumer defaults", () => {
  it("parses exported schemas without requiring consumers to bootstrap extensions first", () => {
    const parsed = RuntimeAgentRunInvocationSchema.parse({
      run: {
        agentServiceId: "veryfront-platform-agent",
        agentId: "assistant",
        conversationId: "10000000-1000-4000-8000-100000000001",
        runId: "run-1",
        messageId: "10000000-1000-4000-8000-100000000002",
        inputAnchorMessageId: "10000000-1000-4000-8000-100000000002",
        requestedByUserId: "10000000-1000-4000-8000-100000000003",
        project: {
          projectId: "10000000-1000-4000-8000-100000000004",
          projectSlug: "demo-project",
        },
      },
      messages: [{ id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      tools: [],
      context: [],
      agentSource: { type: "branch", branch: "main" },
    });

    assertEquals(parsed.run.agentId, "assistant");
  });
});
