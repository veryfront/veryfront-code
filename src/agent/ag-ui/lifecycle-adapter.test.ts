import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import fixture from "../conversation/fixtures/legacy-content-after-end.json" with {
  type: "json",
};
import { readConversationRunLifecycleFrames } from "../conversation/legacy-run-read-adapter.ts";
import { createLifecycleAgUiAdapter } from "#veryfront/agent/ag-ui/lifecycle-adapter.ts";

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

describe("lifecycle AG-UI adapter", () => {
  it("assigns stable text identities when protocol events omit IDs", () => {
    const adapter = createLifecycleAgUiAdapter({
      messageId: "message-1",
    });
    const events = frames([
      { event: { type: "text_start" } },
      { event: { type: "text_content", delta: "first" } },
      { event: { type: "text_end" } },
      { event: { type: "text_start" } },
      { event: { type: "text_content", delta: "second" } },
      { event: { type: "text_end" } },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(
      events.map((entry) => entry.payload.contentId),
      ["text:0", "text:0", "text:0", "text:1", "text:1", "text:1"],
    );
  });

  // Same defect as encoder: providers restart part ids at `reasoning-0`
  // every step, so composing the run-global id from the part id alone collides.
  it("gives each reasoning span a distinct messageId when a provider reuses part ids", () => {
    const adapter = createLifecycleAgUiAdapter({
      messageId: "message-multistep",
    });
    const events = frames([
      { event: { type: "step_start" } },
      { event: { type: "reasoning_start", id: "reasoning-0" } },
      { event: { type: "reasoning_content", id: "reasoning-0", delta: "step one" } },
      { event: { type: "reasoning_end", id: "reasoning-0" } },
      { event: { type: "step_finish" } },
      { event: { type: "step_start" } },
      { event: { type: "reasoning_start", id: "reasoning-0" } },
      { event: { type: "reasoning_content", id: "reasoning-0", delta: "step two" } },
      { event: { type: "reasoning_end", id: "reasoning-0" } },
      { event: { type: "step_finish" } },
    ]).flatMap((frame) => adapter.encode(frame));

    const starts = events
      .filter((entry) => entry.event === "ReasoningMessageStart")
      .map((entry) => entry.payload.messageId as string);

    assertEquals(starts.length, 2, "both reasoning spans should start");
    assertEquals(
      new Set(starts).size,
      2,
      `each reasoning span needs its own messageId, got ${JSON.stringify(starts)}`,
    );

    // Content and end must stay on the id their own span opened.
    const perSpan = events
      .filter((entry) => entry.event.startsWith("ReasoningMessage"))
      .map((entry) => entry.payload.messageId as string);
    assertEquals(
      perSpan,
      [starts[0], starts[0], starts[0], starts[1], starts[1], starts[1]],
      "each span's start, content and end must share one messageId",
    );
  });

  it("projects a balanced canonical sequence with matched identities", () => {
    const adapter = createLifecycleAgUiAdapter({
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

  it("emits only the final provider result after ready and preliminary output", () => {
    const adapter = createLifecycleAgUiAdapter({ messageId: "message-provider" });
    const events = frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "provider-1",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "provider-1",
          toolName: "web_fetch",
          input: { url: "https://docs.example/page" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_start",
          toolCallId: "provider-1",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-1",
          toolName: "web_fetch",
          output: { partial: true },
          isError: false,
          providerExecuted: true,
          preliminary: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-1",
          toolName: "web_fetch",
          output: { content: "final" },
          isError: false,
          providerExecuted: true,
        },
      },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(events.map((event) => event.event), [
      "ToolCallStart",
      "ToolCallArgs",
      "ToolCallEnd",
      "ToolCallResult",
    ]);
    assertEquals(events.at(-1)?.payload, {
      toolCallId: "provider-1",
      result: { content: "final" },
    });
  });

  it("keeps a tool-handoff attempt open and finishes only on run completion", () => {
    const adapter = createLifecycleAgUiAdapter({
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

    const adapter = createLifecycleAgUiAdapter({
      messageId: "legacy-message",
    });
    const agUiEvents = [
      ...read.frames.flatMap((frame) => adapter.encode(frame)),
      ...adapter.finalize({ terminalStatus: "completed" }),
    ];
    assertEquals(
      agUiEvents.filter((entry) => entry.event === "TextMessageContent")
        .map((entry) => entry.payload.delta).join(""),
      "firstsecond",
    );
    assertEquals(
      new Set(
        agUiEvents.filter((entry) => entry.event.startsWith("TextMessage"))
          .map((entry) => entry.payload.messageId),
      ),
      new Set(["legacy-message"]),
    );
    assertEquals(
      new Set(
        agUiEvents.filter((entry) => entry.event === "TextMessageStart")
          .map((entry) => entry.payload.contentId),
      ).size,
      2,
    );
    assertEquals(
      agUiEvents.filter((entry) => entry.event === "TextMessageStart")
        .length,
      agUiEvents.filter((entry) => entry.event === "TextMessageEnd").length,
    );
    assertEquals(
      agUiEvents.filter((entry) => entry.event === "RunFinished").length,
      1,
    );
  });

  it("reports empty completion and cancellation with typed run errors", () => {
    const empty = createLifecycleAgUiAdapter({ messageId: "m" });
    assertEquals(empty.finalize({ terminalStatus: "completed" }), [{
      event: "RunError",
      payload: {
        code: "EMPTY_ASSISTANT_OUTPUT",
        message: "Agent run produced no assistant-visible output",
      },
    }]);
    assertEquals(empty.finalize({ terminalStatus: "completed" }), []);

    const cancelled = createLifecycleAgUiAdapter({ messageId: "m" });
    assertEquals(cancelled.finalize({ terminalStatus: "cancelled" }), [{
      event: "RunError",
      payload: { code: "STREAM_CANCELLED", message: "Stream was cancelled" },
    }]);
  });

  it("drops a reasoning end that closes no open span", () => {
    const adapter = createLifecycleAgUiAdapter({
      messageId: "message-unmatched-end",
    });
    const events = frames([
      { event: { type: "reasoning_end", id: "reasoning-0" } },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(
      events.filter((entry) => entry.event === "ReasoningMessageEnd"),
      [],
      "an end with no span open must not emit a ReasoningMessageEnd",
    );

    // The dropped end must not consume an ordinal: the next real span is still 0.
    const started = frames([
      { event: { type: "reasoning_start", id: "reasoning-0" } },
    ]).flatMap((frame) => adapter.encode(frame));
    assertEquals(started, [{
      event: "ReasoningMessageStart",
      payload: { messageId: "message-unmatched-end:reasoning:0", role: "reasoning" },
    }]);
  });

  it("opens a reasoning span visibly when a delta arrives with none open", () => {
    const adapter = createLifecycleAgUiAdapter({
      messageId: "message-orphan-delta",
    });
    const events = frames([
      { event: { type: "reasoning_content", id: "reasoning-0", delta: "thinking" } },
      { event: { type: "reasoning_end", id: "reasoning-0" } },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(events, [
      {
        event: "ReasoningMessageStart",
        payload: { messageId: "message-orphan-delta:reasoning:0", role: "reasoning" },
      },
      {
        event: "ReasoningMessageContent",
        payload: { messageId: "message-orphan-delta:reasoning:0", delta: "thinking" },
      },
      {
        event: "ReasoningMessageEnd",
        payload: { messageId: "message-orphan-delta:reasoning:0" },
      },
    ]);
  });
});
