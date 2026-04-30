import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { Message as AgentMessage } from "./schemas/index.ts";
import {
  buildRecoveredStepParts,
  createFrameworkStreamState,
  createStreamedStepState,
  type ForkRuntimeStep,
  mapFrameworkEventToForkParts,
  resolveForkStepResponse,
} from "./fork-runtime-stream.ts";

describe("agent/fork-runtime-stream", () => {
  it("maps framework tool input and output events into fork parts", () => {
    const state = createFrameworkStreamState();

    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" },
        state,
      ),
      [{ type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" }],
    );
    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"path":' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '{"path":' }],
    );
    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '"/plans/a.md"}' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '"/plans/a.md"}' }],
    );
    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-input-available", toolCallId: "tool-1", toolName: "create_file", input: {} },
        state,
      ),
      [{
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      }],
    );
    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-output-available", toolCallId: "tool-1", output: { path: "/plans/a.md" } },
        state,
      ),
      [
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "create_file",
          input: { path: "/plans/a.md" },
          output: { path: "/plans/a.md" },
        },
      ],
    );
  });

  it("routes stream recovery warnings through the injected logger", () => {
    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const logger = {
      warn: (message: string, metadata?: Record<string, unknown>) => {
        warnings.push({ message, metadata });
      },
    };
    const state = createFrameworkStreamState({ logger });

    assertEquals(
      mapFrameworkEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "{}" },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: "{}" }],
    );

    const step: ForkRuntimeStep = {
      text: "done",
      messages: [],
      toolCalls: [{
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      }],
      toolResults: [],
      finishReason: "stop",
    };
    const recovered = buildRecoveredStepParts(step, state);

    assertEquals(recovered, [
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      },
    ]);
    assertEquals(warnings.length, 2);
    assertEquals(
      warnings[0]?.message,
      "Child fork received tool-input-delta before tool-input-start",
    );
    assertEquals(warnings[1]?.message, "Child fork recovered missing tool-call from final step");
  });

  it("recovers a timed-out final response from previously written artifacts", async () => {
    const responsePromise = new Promise<never>(() => {});
    const currentMessages: AgentMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: Date.now(),
        parts: [
          {
            type: "tool-create_file",
            toolCallId: "tool-1",
            toolName: "create_file",
            args: { path: "research/report.md", content: "# Report" },
          },
        ],
      },
      {
        id: "tool-1-result",
        role: "tool",
        timestamp: Date.now(),
        parts: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "create_file",
            result: { path: "research/report.md" },
          },
        ],
      },
    ];

    const response = await resolveForkStepResponse({
      responsePromise,
      responseTimeoutMs: 1,
      currentMessages,
      streamedStepState: createStreamedStepState(),
    });

    assertEquals(
      response.text,
      "Completed child tool work. Project artifact(s): research/report.md.",
    );
    assertEquals(response.status, "completed");
    assertExists(response.messages.find((message) => message.role === "assistant"));
  });
});
