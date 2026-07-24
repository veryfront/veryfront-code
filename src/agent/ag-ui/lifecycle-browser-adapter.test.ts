import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import fixture from "../conversation/fixtures/legacy-content-after-end.json" with {
  type: "json",
};
import { readConversationRunLifecycleFrames } from "../conversation/legacy-run-read-adapter.ts";
import { createLifecycleAgUiBrowserAdapter } from "./lifecycle-browser-adapter.ts";

function frames(
  entries: readonly {
    class?: StreamLifecycleFrame["class"];
    event: unknown;
  }[],
): StreamLifecycleFrame[] {
  return entries.map((entry, index) => ({
    class: entry.class ?? "semantic",
    event: entry.event,
    sequence: index + 1,
    elapsedMs: index,
  } as StreamLifecycleFrame));
}

describe("lifecycle AG-UI browser adapter", () => {
  it("projects a balanced canonical sequence with matched identities", () => {
    const adapter = createLifecycleAgUiBrowserAdapter({
      messageId: "message-1",
    });
    const events = frames([
      { event: { type: "step_start" } },
      { event: { type: "reasoning_start", id: "r1" } },
      { event: { type: "reasoning_content", id: "r1", delta: "thinking" } },
      { event: { type: "reasoning_end", id: "r1" } },
      { event: { type: "text_start", id: "text:0" } },
      { event: { type: "text_content", id: "text:0", delta: "answer" } },
      { event: { type: "text_end", id: "text:0" } },
      {
        event: {
          type: "tool_input_start",
          toolCallId: "local-1",
          toolName: "create_file",
        },
      },
      {
        event: {
          type: "tool_input_content",
          toolCallId: "local-1",
          delta: '{"path":"a.md"}',
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "local-1",
          toolName: "create_file",
          input: { path: "a.md" },
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "native-1",
          toolName: "web_search",
          output: { ok: true },
          isError: false,
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "usage",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
      },
      { event: { type: "step_finish", finishReason: "tool-calls" } },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(events.map((entry) => entry.event), [
      "StepStarted",
      "ReasoningMessageStart",
      "ReasoningMessageContent",
      "ReasoningMessageEnd",
      "TextMessageStart",
      "TextMessageContent",
      "TextMessageEnd",
      "ToolCallStart",
      "ToolCallArgs",
      "ToolCallEnd",
      "ToolCallResult",
      "StepFinished",
    ]);
    const starts = events.filter((entry) =>
      entry.event.endsWith("Start") && entry.event !== "ToolCallStart" &&
      entry.event !== "StepStarted"
    );
    for (const start of starts) {
      const endName = start.event.replace("Start", "End");
      const matching = events.filter((entry) =>
        entry.event === endName &&
        entry.payload.messageId === start.payload.messageId &&
        entry.payload.contentId === start.payload.contentId
      );
      assertEquals(matching.length, 1, start.event);
    }
  });

  it("keeps a tool-handoff attempt open and finishes only on run completion", () => {
    const adapter = createLifecycleAgUiBrowserAdapter({
      messageId: "message-1",
    });
    for (
      const frame of frames([
        { event: { type: "text_start", id: "text:0" } },
        { event: { type: "text_content", id: "text:0", delta: "working" } },
        { event: { type: "text_end", id: "text:0" } },
      ])
    ) {
      adapter.encode(frame);
    }
    const handoff = adapter.finalize({
      outcome: {
        status: "tool_handoff",
        finishReason: "tool-calls",
        toolCalls: [],
        snapshot: {
          phase: "tool_handoff",
          accumulatedText: "working",
          reasoning: [],
          tools: [],
          finishReason: "tool-calls",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          hasStreamOutput: true,
          hasSemanticProgress: true,
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        elapsedMs: 10,
        phase: "tool_handoff",
      },
    });
    assertEquals(handoff, []);

    const completed = adapter.finalize({ terminalStatus: "completed" });
    assertEquals(completed.map((entry) => entry.event), ["RunFinished"]);
  });

  it("renders the immutable legacy fixture as one balanced message", () => {
    const read = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: fixture.events,
    });
    assertEquals(read.status, "ok");
    if (read.status !== "ok") return;

    const adapter = createLifecycleAgUiBrowserAdapter({
      messageId: "legacy-message",
    });
    const browserEvents = [
      ...read.frames.flatMap((frame) => adapter.encode(frame)),
      ...adapter.finalize({ terminalStatus: "completed" }),
    ];
    assertEquals(
      browserEvents.filter((entry) => entry.event === "TextMessageContent")
        .map((entry) => entry.payload.delta).join(""),
      "firstsecond",
    );
    assertEquals(
      new Set(
        browserEvents.filter((entry) => entry.event.startsWith("TextMessage"))
          .map((entry) => entry.payload.messageId),
      ),
      new Set(["legacy-message"]),
    );
    assertEquals(
      new Set(
        browserEvents.filter((entry) => entry.event === "TextMessageStart")
          .map((entry) => entry.payload.contentId),
      ).size,
      2,
    );
    assertEquals(
      browserEvents.filter((entry) => entry.event === "TextMessageStart")
        .length,
      browserEvents.filter((entry) => entry.event === "TextMessageEnd").length,
    );
    assertEquals(
      browserEvents.filter((entry) => entry.event === "RunFinished").length,
      1,
    );
  });

  it("reports empty completion and cancellation with typed run errors", () => {
    const empty = createLifecycleAgUiBrowserAdapter({ messageId: "m" });
    assertEquals(empty.finalize({ terminalStatus: "completed" }), [{
      event: "RunError",
      payload: {
        code: "EMPTY_ASSISTANT_OUTPUT",
        message: "Agent run produced no assistant-visible output",
      },
    }]);
    assertEquals(empty.finalize({ terminalStatus: "completed" }), []);

    const cancelled = createLifecycleAgUiBrowserAdapter({ messageId: "m" });
    assertEquals(cancelled.finalize({ terminalStatus: "cancelled" }), [{
      event: "RunError",
      payload: { code: "STREAM_CANCELLED", message: "Stream was cancelled" },
    }]);
  });
});
