import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { Message as AgentMessage } from "../schemas/index.ts";
import {
  applyPartToStreamedStepState,
  createStreamedStepState,
  resolveForkStepResponse,
} from "./fork-runtime-step-state.ts";

describe("agent/fork-runtime-step-state", () => {
  it("builds a fallback agent response from streamed text and tool parts", async () => {
    const currentMessages: AgentMessage[] = [{
      id: "user-1",
      role: "user",
      timestamp: 1,
      parts: [{ type: "text", text: "Create the plan." }],
    }];
    const state = createStreamedStepState();

    applyPartToStreamedStepState(state, { type: "text-delta", text: "Created." });
    applyPartToStreamedStepState(state, {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "plan.md" },
    });
    applyPartToStreamedStepState(state, {
      type: "tool-result",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "plan.md" },
      output: { path: "plan.md", ok: true },
    });

    const response = await resolveForkStepResponse({
      responsePromise: new Promise<never>(() => {}),
      responseTimeoutMs: 1,
      currentMessages,
      streamedStepState: state,
    });

    assertEquals(response.text, "Created.");
    assertEquals(response.status, "completed");
    assertEquals(response.toolCalls, [{
      id: "tool-1",
      name: "create_file",
      args: { path: "plan.md" },
      status: "completed",
      result: { path: "plan.md", ok: true },
    }]);
    assertEquals(response.messages.map((message) => message.role), [
      "user",
      "assistant",
      "tool",
    ]);
  });
});
