import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "jsr:@std/testing@1.0.17/time";
import {
  createChatStreamWatchdog,
  getNextChatStreamWatchdogState,
  isHeartbeatOnlyMetadataChunk,
} from "./stream-watchdog.ts";

const watchdogOptions = {
  idleTimeoutMs: 120,
  toolRunningTimeoutMs: 300,
  longRunningToolNames: ["invoke_agent"],
};

describe("chat/stream-watchdog", () => {
  it("transitions through tool input, running, and post-tool idle states", () => {
    const inputStreaming = getNextChatStreamWatchdogState(
      { phase: "response_pending", timeoutMs: 120 },
      { type: "tool-input-start", toolCallId: "tool-1", toolName: "bash" },
      watchdogOptions,
    );

    assertEquals(inputStreaming, {
      phase: "tool_input_streaming",
      timeoutMs: 120,
      toolCallId: "tool-1",
      toolName: "bash",
    });

    const running = getNextChatStreamWatchdogState(
      inputStreaming,
      { type: "tool-input-available", toolCallId: "tool-1", toolName: "bash", input: {} },
      watchdogOptions,
    );

    assertEquals(running, {
      phase: "tool_running",
      timeoutMs: 300,
      toolCallId: "tool-1",
      toolName: "bash",
    });

    assertEquals(
      getNextChatStreamWatchdogState(
        running,
        { type: "tool-output-available", toolCallId: "tool-1", output: "ok" },
        watchdogOptions,
      ),
      {
        phase: "post_tool_idle",
        timeoutMs: 120,
        toolCallId: "tool-1",
        toolName: "bash",
      },
    );
  });

  it("keeps long-running tools alive across non-heartbeat chunks until output arrives", () => {
    const running = getNextChatStreamWatchdogState(
      { phase: "response_pending", timeoutMs: 120 },
      { type: "tool-input-available", toolCallId: "fork-1", toolName: "invoke_agent", input: {} },
      watchdogOptions,
    );

    assertEquals(
      getNextChatStreamWatchdogState(
        running,
        { type: "message-metadata", messageMetadata: { modelId: "anthropic/claude-sonnet-4-6" } },
        watchdogOptions,
      ),
      running,
    );

    assertEquals(
      getNextChatStreamWatchdogState(
        running,
        { type: "tool-output-error", toolCallId: "fork-1", errorText: "cancelled" },
        watchdogOptions,
      ),
      {
        phase: "post_tool_idle",
        timeoutMs: 120,
        toolCallId: "fork-1",
        toolName: "invoke_agent",
      },
    );
  });

  it("detects heartbeat-only metadata chunks", () => {
    assertEquals(
      isHeartbeatOnlyMetadataChunk({ type: "message-metadata", messageMetadata: {} }),
      true,
    );
    assertEquals(
      isHeartbeatOnlyMetadataChunk({
        type: "message-metadata",
        messageMetadata: { modelId: "model" },
      }),
      false,
    );
  });

  it("accepts injected timer functions for host test instrumentation", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      setTimeoutFn: globalThis.setTimeout,
      clearTimeoutFn: globalThis.clearTimeout,
    });
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "tool-3",
      toolName: "bash",
      input: {},
    });

    time.tick(301);

    assertEquals(watchdog.signal.aborted, true);
    watchdog.dispose();
  });

  it("creates a default watchdog with host timer bindings", () => {
    const watchdog = createChatStreamWatchdog();

    assertEquals(watchdog.signal.aborted, false);
    watchdog.dispose();
  });

  it("aborts with AbortError and records timeout state", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog(watchdogOptions);
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "tool-2",
      toolName: "bash",
      input: {},
    });

    time.tick(301);

    assertEquals(watchdog.signal.aborted, true);
    assertInstanceOf(watchdog.signal.reason, DOMException);
    const reason = watchdog.signal.reason;
    if (reason instanceof DOMException) {
      assertEquals(reason.name, "AbortError");
    }
    assertEquals(watchdog.lastTimeoutState, {
      phase: "tool_running",
      timeoutMs: 300,
      toolCallId: "tool-2",
      toolName: "bash",
    });
    watchdog.dispose();
  });

  it("does not arm a timer while a configured long-running tool is running", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog(watchdogOptions);
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "fork-2",
      toolName: "invoke_agent",
      input: {},
    });

    time.tick(10_000);

    assertEquals(watchdog.signal.aborted, false);
    assertEquals(watchdog.lastTimeoutState, null);
    watchdog.dispose();
  });
});
