import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { AgentResponse } from "../types.ts";
import {
  buildForkRuntimeStepFromResponse,
  commitForkRuntimeStep,
  createForkRuntimeProgress,
  getForkRuntimeProgressUsage,
  shouldContinueForkRuntimeStep,
} from "./fork-runtime-step-progress.ts";

describe("agent/fork-runtime-step-progress", () => {
  it("builds fork runtime steps from agent responses", () => {
    const response: AgentResponse = {
      text: "Saved.",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "tool-create_file",
            toolCallId: "tool-1",
            toolName: "create_file",
            args: { path: "plans/a.md" },
          }],
        },
      ],
      toolCalls: [
        {
          id: "tool-1",
          name: "create_file",
          args: { path: "plans/a.md" },
          status: "completed",
          result: { path: "plans/a.md", success: true },
        },
      ],
      status: "completed",
      metadata: { finishReason: "tool-calls" },
    };

    const step = buildForkRuntimeStepFromResponse(response);

    assertEquals(step, {
      text: "Saved.",
      messages: response.messages,
      toolCalls: [{ toolCallId: "tool-1", toolName: "create_file", input: { path: "plans/a.md" } }],
      toolResults: [{
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "plans/a.md" },
        output: { path: "plans/a.md", success: true },
      }],
      finishReason: "tool-calls",
    });
    assertEquals(shouldContinueForkRuntimeStep(step, response), true);
  });

  it("commits steps and accumulates usage for the fork runtime loop", () => {
    const initialMessages = [{
      id: "user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Start" }],
    }];
    const progress = createForkRuntimeProgress(initialMessages);
    const firstResponse: AgentResponse = {
      text: "First.",
      messages: [{
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "First." }],
      }],
      toolCalls: [],
      status: "completed",
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    };
    const secondResponse: AgentResponse = {
      text: "Second.",
      messages: [{
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "text", text: "Second." }],
      }],
      toolCalls: [],
      status: "completed",
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    };

    const firstStep = commitForkRuntimeStep(progress, firstResponse);
    const secondStep = commitForkRuntimeStep(progress, secondResponse);

    assertEquals(progress.steps, [firstStep, secondStep]);
    assertEquals(progress.currentMessages, secondResponse.messages);
    assertEquals(getForkRuntimeProgressUsage(progress), {
      inputTokens: 7,
      outputTokens: 10,
    });
  });
});
