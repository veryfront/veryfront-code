import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import {
  applyLifecycleSnapshotToChatStreamState,
  createStreamLifecycleLiveAdapter,
} from "./live-adapter.ts";
import type { StreamLifecycleFrame, StreamSnapshot } from "./types.ts";

function frames(
  entries: readonly StreamLifecycleFrame["event"][],
): StreamLifecycleFrame[] {
  return entries.map((event, index) => {
    const record = event as { type: string };
    const cls = record.type === "tool_input_status" ? "telemetry" as const : "semantic" as const;
    return {
      class: cls,
      event,
      sequence: index + 1,
      elapsedMs: index,
    } as StreamLifecycleFrame;
  });
}

describe("stream lifecycle live adapter", () => {
  it("locks the current Data Stream Protocol shapes", () => {
    const adapter = createStreamLifecycleLiveAdapter({
      textPartId: "text-part",
    });
    const events = frames([
      { type: "text_start", id: "text:0" },
      { type: "text_content", id: "text:0", delta: "hello" },
      { type: "text_end", id: "text:0" },
      {
        type: "tool_input_start",
        toolCallId: "local-1",
        toolName: "create_file",
      },
      {
        type: "tool_input_content",
        toolCallId: "local-1",
        delta: '{"path":"a.md"}',
      },
      {
        type: "tool_input_ready",
        toolCallId: "local-1",
        toolName: "create_file",
        input: { path: "a.md" },
      },
      {
        type: "tool_input_status",
        toolCallId: "local-1",
        status: "pending_input",
      },
    ]).flatMap((frame) => adapter.encode(frame));

    assertEquals(events, [
      { type: "text-start", id: "text-part" },
      { type: "text-delta", id: "text-part", delta: "hello" },
      { type: "text-end", id: "text-part" },
      {
        type: "tool-input-start",
        toolCallId: "local-1",
        toolName: "create_file",
      },
      {
        type: "tool-input-delta",
        toolCallId: "local-1",
        inputTextDelta: '{"path":"a.md"}',
      },
      {
        type: "tool-input-available",
        toolCallId: "local-1",
        toolName: "create_file",
        input: { path: "a.md" },
      },
      {
        type: "data-tool-call-status",
        data: { toolCallId: "local-1", status: "pending_input" },
      },
    ]);
  });

  it("maps reasoning, provider output, usage, and diagnostics", () => {
    const adapter = createStreamLifecycleLiveAdapter({ textPartId: "text-1" });
    assertEquals(
      frames([
        { type: "reasoning_start", id: "r1" },
        { type: "reasoning_content", id: "r1", delta: "thinking" },
        { type: "reasoning_end", id: "r1", signature: "sig" },
      ]).flatMap((frame) => adapter.encode(frame)),
      [
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "thinking" },
        { type: "reasoning-end", id: "r1", signature: "sig" },
      ],
    );
    assertEquals(
      frames([{
        type: "provider_tool_result",
        toolCallId: "native-1",
        toolName: "web_search",
        output: { ok: true },
        isError: false,
        providerExecuted: true,
      }]).flatMap((frame) => adapter.encode(frame)),
      [{
        type: "tool-output-available",
        toolCallId: "native-1",
        output: { ok: true },
        providerExecuted: true,
      }],
    );
    assertEquals(
      frames([
        {
          type: "usage",
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        },
        { type: "step_finish", finishReason: "stop" },
      ]).flatMap((frame) => adapter.encode(frame)),
      [],
    );
    assertEquals(
      adapter.encode({
        class: "diagnostic",
        event: { type: "protocol_repair", code: "implicit_text_start" },
        sequence: 1,
        elapsedMs: 0,
      }),
      [],
    );
  });

  it("projects the final snapshot into the legacy chat stream state", () => {
    const state = createStreamState();
    const snapshot: StreamSnapshot = {
      phase: "tool_handoff",
      accumulatedText: "answer",
      reasoning: [{ id: "r1", text: "thinking" }],
      tools: [
        {
          id: "local-1",
          name: "create_file",
          phase: "input_ready",
          inputText: '{"path":"a.md"}',
          inputDeltas: ['{"path":', '"a.md"}'],
          input: { path: "a.md" },
        },
        {
          id: "missing-1",
          name: "missing_tool",
          phase: "input_rejected",
          inputText: "",
          inputDeltas: [],
          rejectionReason: "unavailable",
        },
        {
          id: "native-1",
          name: "web_search",
          phase: "succeeded",
          inputText: "{}",
          inputDeltas: [],
          input: {},
          output: { ok: true },
          providerExecuted: true,
          preliminary: false,
        },
        {
          id: "native-2",
          name: "web_search",
          phase: "failed",
          inputText: "{}",
          inputDeltas: [],
          input: {},
          error: "boom",
          providerExecuted: true,
        },
      ],
      finishReason: "tool-calls",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 4,
        costUsd: 0.5,
        costSource: "gateway",
        billingMode: "direct",
        usageCaptureStatus: "complete",
      },
      hasStreamOutput: true,
      hasSemanticProgress: true,
    };

    applyLifecycleSnapshotToChatStreamState(state, snapshot);

    assertEquals(state.accumulatedText, "answer");
    assertEquals(state.reasoningParts, [{ id: "r1", text: "thinking" }]);
    assertEquals(state.finishReason, "tool-calls");
    assertEquals([...state.toolCalls.keys()], [
      "local-1",
      "native-1",
      "native-2",
    ]);
    assertEquals(state.toolCalls.get("local-1"), {
      id: "local-1",
      name: "create_file",
      arguments: '{"path":"a.md"}',
      inputDeltas: ['{"path":', '"a.md"}'],
      inputAnnounced: true,
      inputAvailable: true,
    });
    assertEquals(state.toolResults, [
      {
        toolCallId: "native-1",
        toolName: "web_search",
        output: { ok: true },
        providerExecuted: true,
        preliminary: false,
      },
      {
        toolCallId: "native-2",
        toolName: "web_search",
        error: "boom",
        providerExecuted: true,
      },
    ]);
    assertEquals(state.suppressedToolCalls, [{
      id: "missing-1",
      name: "missing_tool",
    }]);
    assertEquals(state.usage, {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cachedInputTokens: 4,
      costUsd: 0.5,
      costSource: "gateway",
      billingMode: "direct",
      usageCaptureStatus: "complete",
    });
    assertEquals(state.usage === snapshot.usage as unknown, false);
  });
});
