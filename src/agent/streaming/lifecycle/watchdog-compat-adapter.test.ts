import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ChatStreamWatchdogState,
  mapWatchdogChunkToLifecycleActivity,
} from "./watchdog-compat-adapter.ts";

const state: ChatStreamWatchdogState = {
  phase: "response_pending",
  timeoutMs: 120,
};

describe("mapWatchdogChunkToLifecycleActivity", () => {
  it("classifies telemetry that must never extend a deadline", () => {
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "message-metadata",
        messageMetadata: {},
      }),
      { type: "telemetry" },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "message-metadata",
        messageMetadata: { modelId: "anthropic/claude-sonnet-4-6" },
      }),
      { type: "telemetry" },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      }),
      { type: "telemetry" },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "text-delta",
        id: "text-1",
        delta: "",
      }),
      { type: "telemetry" },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "tool-input-delta",
        toolCallId: "tool-1",
        inputTextDelta: "",
      }),
      { type: "telemetry" },
      "empty tool-input deltas must not extend the deadline",
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "reasoning-delta",
        id: "r1",
        delta: "",
      }),
      { type: "telemetry" },
      "empty reasoning deltas must not extend the deadline",
    );
  });

  it("classifies semantic progress, transitions, and completion", () => {
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "text-delta",
        id: "text-1",
        delta: "hello",
      }),
      { type: "semantic_progress", phase: "streaming" },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "bash",
      }),
      {
        type: "phase_transition",
        phase: "awaiting_tool_input",
        toolCallId: "tool-1",
        toolName: "bash",
      },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "bash",
        input: {},
      }),
      {
        type: "semantic_progress",
        phase: "tool_handoff",
        toolCallId: "tool-1",
        toolName: "bash",
      },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: "ok",
      }),
      {
        type: "semantic_progress",
        phase: "streaming",
        toolCallId: "tool-1",
      },
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(state, { type: "finish" }),
      { type: "completed" },
    );

    const toolState: ChatStreamWatchdogState = {
      phase: "tool_input_streaming",
      timeoutMs: 120,
      toolCallId: "tool-1",
      toolName: "bash",
    };
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(toolState, {
        type: "tool-input-delta",
        toolCallId: "tool-1",
        inputTextDelta: '{"a":1}',
      }),
      {
        type: "semantic_progress",
        phase: "awaiting_tool_input",
        toolCallId: "tool-1",
        toolName: "bash",
      },
      "non-empty tool-input deltas are semantic progress carrying the current tool name",
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(toolState, {
        type: "tool-output-error",
        toolCallId: "tool-1",
        errorText: "boom",
      }),
      {
        type: "semantic_progress",
        phase: "streaming",
        toolCallId: "tool-1",
        toolName: "bash",
      },
      "a tool output error is semantic progress that returns the stream to streaming",
    );
    assertEquals(
      mapWatchdogChunkToLifecycleActivity(toolState, {
        type: "tool-output-denied",
        toolCallId: "tool-1",
      }),
      {
        type: "semantic_progress",
        phase: "streaming",
        toolCallId: "tool-1",
        toolName: "bash",
      },
      "a denied tool output is semantic progress that returns the stream to streaming",
    );
  });
});
