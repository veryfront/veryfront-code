import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import * as streamWatchdog from "./stream-watchdog.ts";
import {
  createChatStreamWatchdog,
  DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
  getNextChatStreamWatchdogState,
  isHeartbeatOnlyMetadataChunk,
} from "./stream-watchdog.ts";
// @ts-expect-error Lifecycle activity mapping is internal to the stream lifecycle module.
import type { mapWatchdogChunkToLifecycleActivity as _mapWatchdogChunkToLifecycleActivity } from "./stream-watchdog.ts";
// @ts-expect-error Lifecycle activity shape is internal to the stream lifecycle module.
import type { WatchdogLifecycleActivity as _WatchdogLifecycleActivity } from "./stream-watchdog.ts";

const watchdogOptions = {
  idleTimeoutMs: 120,
  toolRunningTimeoutMs: 300,
  longRunningToolNames: ["invoke_agent"],
  longRunningToolPrefixes: ["agent_"],
};

describe("chat/stream-watchdog", () => {
  it("keeps lifecycle activity helpers out of the public barrel", () => {
    const surface = streamWatchdog as Record<string, unknown>;

    assertEquals("mapWatchdogChunkToLifecycleActivity" in surface, false);
  });

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

  it("keeps scoped delegate tools alive by configured prefix", () => {
    const running = getNextChatStreamWatchdogState(
      { phase: "response_pending", timeoutMs: 120 },
      {
        type: "tool-input-available",
        toolCallId: "delegate-1",
        toolName: "agent_extraction-agent",
        input: {},
      },
      watchdogOptions,
    );

    assertEquals(
      getNextChatStreamWatchdogState(
        running,
        { type: "message-metadata", messageMetadata: { modelId: "openai/gpt-5.4" } },
        watchdogOptions,
      ),
      running,
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
    let scheduled = 0;
    let cleared = 0;
    const setTimeoutFn = ((cb: () => void, ms?: number) => {
      scheduled++;
      return globalThis.setTimeout(cb, ms);
    }) as typeof setTimeout;
    const clearTimeoutFn = ((handle?: number) => {
      cleared++;
      globalThis.clearTimeout(handle);
    }) as typeof clearTimeout;
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      setTimeoutFn,
      clearTimeoutFn,
    });
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "tool-3",
      toolName: "bash",
      input: {},
    });

    time.tick(301);

    assertEquals(watchdog.signal.aborted, true);
    assertEquals(
      scheduled >= 1,
      true,
      "the injected setTimeoutFn must schedule the watchdog deadline",
    );
    watchdog.dispose();
    assertEquals(
      cleared >= 1,
      true,
      "the injected clearTimeoutFn must cancel the watchdog deadline",
    );
  });

  it("keeps response pending watchdogs alive without requiring a stream chunk", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog(watchdogOptions);

    time.tick(60);
    watchdog.keepAlive();
    time.tick(61);

    assertEquals(watchdog.signal.aborted, false);
    time.tick(60);

    assertEquals(watchdog.signal.aborted, true);
    assertEquals(watchdog.lastTimeoutState, {
      phase: "response_pending",
      timeoutMs: 120,
    });
    watchdog.dispose();
  });

  it("creates a default watchdog with host timer bindings", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog();

    assertEquals(
      DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
      120_000,
      "the documented default idle timeout must stay 120s",
    );
    assertEquals(watchdog.signal.aborted, false);

    time.tick(DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS - 1);

    assertEquals(
      watchdog.signal.aborted,
      false,
      "the default watchdog must not abort before its deadline",
    );

    time.tick(2);

    assertEquals(
      watchdog.signal.aborted,
      true,
      "an option-less watchdog must arm the default idle deadline",
    );
    assertEquals(
      watchdog.lastTimeoutState,
      { phase: "response_pending", timeoutMs: DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS },
      "the default deadline must be recorded as a response pending timeout",
    );
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

  it("keeps an absolute limit for configured long-running tools (strict)", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      toolRunningTimeoutMs: 300,
      strictDeadlines: true,
    });
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "fork-2",
      toolName: "invoke_agent",
      input: {},
    });

    time.tick(301);

    assertEquals(watchdog.signal.aborted, true);
    assertEquals(watchdog.lastTimeoutState?.phase, "tool_running");
    watchdog.dispose();
  });

  it("does not let heartbeat metadata or status telemetry advance the deadline (strict)", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      strictDeadlines: true,
    });

    time.tick(100);
    watchdog.observe({ type: "message-metadata", messageMetadata: {} });
    watchdog.observe({
      type: "message-metadata",
      messageMetadata: { modelId: "anthropic/claude-sonnet-4-6" },
    });
    watchdog.observe({
      type: "data-tool-call-status",
      data: { toolCallId: "tool-1", status: "pending_input" },
    });
    assertEquals(watchdog.signal.aborted, false);

    time.tick(21);

    assertEquals(watchdog.signal.aborted, true);
    assertEquals(watchdog.lastTimeoutState?.phase, "response_pending");
    watchdog.dispose();
  });

  it("legacy mode never arms a deadline for configured long-running tools", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      strictDeadlines: false,
    });
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "fork-3",
      toolName: "invoke_agent",
      input: {},
    });

    time.tick(100_000);

    assertEquals(watchdog.signal.aborted, false);
    watchdog.dispose();
  });

  it("legacy mode re-arms the deadline on non-empty metadata", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      strictDeadlines: false,
    });

    time.tick(100);
    watchdog.observe({
      type: "message-metadata",
      messageMetadata: { modelId: "anthropic/claude-sonnet-4-6" },
    });
    time.tick(100);

    assertEquals(watchdog.signal.aborted, false);

    time.tick(21);

    assertEquals(watchdog.signal.aborted, true);
    watchdog.dispose();
  });

  it("legacy mode ignores heartbeat-only metadata", () => {
    using time = new FakeTime();
    const watchdog = createChatStreamWatchdog({
      ...watchdogOptions,
      strictDeadlines: false,
    });

    time.tick(100);
    watchdog.observe({ type: "message-metadata", messageMetadata: {} });
    time.tick(21);

    assertEquals(watchdog.signal.aborted, true);
    assertEquals(watchdog.lastTimeoutState?.phase, "response_pending");
    watchdog.dispose();
  });

  it("defaults to legacy deadline semantics when no lifecycle mode is set", () => {
    using time = new FakeTime();
    // Test env has no VF_STREAM_LIFECYCLE_MODE, so the default must be the
    // legacy-compatible behavior: long-running tools run without a deadline.
    const watchdog = createChatStreamWatchdog(watchdogOptions);
    watchdog.observe({
      type: "tool-input-available",
      toolCallId: "fork-4",
      toolName: "invoke_agent",
      input: {},
    });

    time.tick(100_000);

    assertEquals(watchdog.signal.aborted, false);
    watchdog.dispose();
  });
});
