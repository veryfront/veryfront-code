import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStreamLifecycleLiveAdapter,
  type StreamLifecycleFrame,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import { createLifecycleAgUiAdapter } from "#veryfront/agent/ag-ui/lifecycle-adapter.ts";
import fixture from "./fixtures/legacy-content-after-end.json" with {
  type: "json",
};
import { createLifecycleRunEventAdapter } from "./lifecycle-run-event-adapter.ts";
import { readConversationRunLifecycleFrames } from "./legacy-run-read-adapter.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";
import { type ConversationRunEvent, normalizeEncodedConversationRunEvents } from "./run-events.ts";

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

function writeDurableEvents(framesToWrite: readonly StreamLifecycleFrame[]) {
  const durableEvents: ConversationRunEvent[] = [];
  const writer = createLifecycleRunEventAdapter({
    runId: "run-1",
    attemptId: "attempt-1",
    attemptIndex: 0,
    messageId: "message-1",
    onEvents: (events) => durableEvents.push(...events),
    setTimer: () => 1,
    clearTimer: () => {},
  });
  for (const frame of framesToWrite) {
    writer.handleFrame(frame);
  }
  writer.dispose();
  return normalizeConversationRunEvents(durableEvents);
}

function projectDurableEventsToAgUi(events: readonly ConversationRunEvent[]) {
  const read = readConversationRunLifecycleFrames({
    streamProtocolVersion: 2,
    events,
  });
  assertEquals(read.status, "ok");
  if (read.status !== "ok") return [];
  const agui = createLifecycleAgUiAdapter({ messageId: "message-1" });
  return read.frames.flatMap((frame) => agui.encode(frame));
}

describe("conversation run lifecycle read adapter", () => {
  it("repairs legacy content after end without rewriting source events", () => {
    const source = structuredClone(fixture.events);
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: fixture.events,
    });

    assertEquals(fixture.events, source);
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, ["legacy_text_content_after_end"]);
    const text = result.frames.filter((frame) =>
      frame.class === "semantic" && frame.event.type === "text_content"
    );
    assertEquals(
      text.map((frame) => (frame.event as { delta: string }).delta),
      ["first", "second"],
    );
    assertEquals(
      new Set(text.map((frame) => (frame.event as { id?: string }).id)).size,
      2,
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "text_start"
      ).length,
      2,
    );
    assertEquals(
      result.frames.filter((frame) => frame.class === "semantic" && frame.event.type === "text_end")
        .length,
      2,
    );
  });

  it("projects a legacy completed tool call without a result as an explicit error", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-fetch",
        toolCallName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-fetch",
        delta: '{"url":"https://docs.example/page"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-fetch",
      },
    ];
    const source = structuredClone(events);

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(events, source);
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, ["legacy_missing_tool_result"]);
    const agui = createLifecycleAgUiAdapter({ messageId: "message-1" });
    assertEquals(
      result.frames.flatMap((frame) => agui.encode(frame)).filter((event) =>
        event.event === "ToolCallResult"
      ),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "legacy-fetch",
          result: { error: "Stored tool call ended without a result" },
          isError: true,
        },
      }],
    );
  });

  it("leaves an unmarked legacy local tool handoff unresolved", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-local",
        toolCallName: "request_approval",
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-local",
        delta: '{"message":"Continue?"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-local",
      },
    ];

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(result.repairs, []);
    assertEquals(
      result.frames.some((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ),
      false,
    );
    assertEquals(
      result.frames.some((frame) =>
        frame.class === "semantic" && frame.event.type === "tool_input_ready"
      ),
      true,
    );
  });

  it("projects a stored version 1 provider-executed tool result", () => {
    // Durable writers serialize structured tool output into `content`, so the
    // stored payload is the writer's JSON text rather than a live object. Take
    // it from the writer itself so this fixture cannot drift from history.
    const storedContent = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "legacy-fetch",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "legacy-fetch",
          toolName: "web_fetch",
          input: { url: "https://docs.example/page" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "legacy-fetch",
          toolName: "web_fetch",
          output: { ok: true },
          isError: false,
          providerExecuted: true,
        },
      },
    ])).find((event) => event.type === "TOOL_CALL_RESULT")?.content;
    assertEquals(
      storedContent,
      '{"ok":true}',
      "the durable writer must store structured tool output as JSON text",
    );

    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-fetch",
        toolCallName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-fetch",
        delta: '{"url":"https://docs.example/page"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-fetch",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        content: storedContent,
        isError: false,
      },
    ];

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.repairs,
      [],
      "a stored v1 result must suppress the legacy_missing_tool_result repair",
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ).map((frame) => frame.event),
      [{
        type: "provider_tool_result",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        output: { ok: true },
        isError: false,
        providerExecuted: true,
      }],
      "a stored v1 provider-executed result must be decoded and replayed exactly once",
    );
  });

  it("preserves JSON-shaped string provider results through durable v1 replay", () => {
    for (const output of ["null", "42", '{"ok":true}']) {
      const durableEvents = writeDurableEvents(frames([
        {
          event: {
            type: "tool_input_start",
            toolCallId: "legacy-fetch",
            toolName: "web_fetch",
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "tool_input_ready",
            toolCallId: "legacy-fetch",
            toolName: "web_fetch",
            input: { url: "https://docs.example/page" },
            providerExecuted: true,
          },
        },
        {
          event: {
            type: "provider_tool_result",
            toolCallId: "legacy-fetch",
            toolName: "web_fetch",
            output,
            isError: false,
            providerExecuted: true,
          },
        },
      ]));
      const storedResult = durableEvents.find((event) => event.type === "TOOL_CALL_RESULT");
      assertEquals(storedResult?.content, output);
      assertEquals(storedResult?.contentEncoding, "text");

      const result = readConversationRunLifecycleFrames({
        streamProtocolVersion: 1,
        events: [
          {
            type: "TOOL_CALL_START",
            toolCallId: "legacy-fetch",
            toolCallName: "web_fetch",
            providerExecuted: true,
          },
          {
            type: "TOOL_CALL_ARGS",
            toolCallId: "legacy-fetch",
            delta: '{"url":"https://docs.example/page"}',
          },
          { type: "TOOL_CALL_END", toolCallId: "legacy-fetch" },
          {
            type: "TOOL_CALL_RESULT",
            toolCallId: "legacy-fetch",
            toolName: "web_fetch",
            content: storedResult?.content,
            contentEncoding: storedResult?.contentEncoding,
            isError: false,
          },
        ],
      });

      assertEquals(result.status, "ok");
      if (result.status !== "ok") continue;
      assertEquals(
        result.frames.filter((frame) =>
          frame.class === "semantic" && frame.event.type === "provider_tool_result"
        ).map((frame) => frame.event),
        [{
          type: "provider_tool_result",
          toolCallId: "legacy-fetch",
          toolName: "web_fetch",
          output,
          isError: false,
          providerExecuted: true,
        }],
      );
    }
  });

  it("keeps a non-JSON version 1 provider-executed tool result verbatim", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-fetch",
        toolCallName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-fetch",
        delta: '{"url":"https://docs.example/page"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-fetch",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        content: "Tool output denied",
        isError: true,
      },
    ];

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ).map((frame) => frame.event),
      [{
        type: "provider_tool_result",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        output: "Tool output denied",
        isError: true,
        providerExecuted: true,
      }],
      "a stored v1 plain-text result must survive decoding unchanged",
    );
  });

  it("replays a provider-executed tool result written by the version 1 writer", () => {
    // Drive the real version 1 writer rather than hand-writing durable events:
    // it is the only producer of version 1 history, so a fixture it could never
    // emit would prove nothing about replaying real runs.
    const stored = normalizeEncodedConversationRunEvents([
      {
        type: "tool-input-start",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        input: { url: "https://docs.example/page" },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "legacy-fetch",
        output: { ok: true },
        providerExecuted: true,
      },
    ]);

    assertEquals(
      stored.find((event) => event.type === "TOOL_CALL_START")?.providerExecuted,
      true,
      "the version 1 writer must record that the started call was provider-executed",
    );
    assertEquals(
      stored.find((event) => event.type === "TOOL_CALL_RESULT")?.content,
      '{"ok":true}',
      "the version 1 writer must store structured tool output as JSON text",
    );

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: stored,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.repairs,
      [],
      "a stored result must suppress the legacy_missing_tool_result repair",
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ).map((frame) => frame.event),
      [{
        type: "provider_tool_result",
        toolCallId: "legacy-fetch",
        toolName: "web_fetch",
        output: { ok: true },
        isError: false,
        providerExecuted: true,
      }],
      "a provider result written by the v1 writer must replay as a provider tool result",
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "custom" &&
        (frame.event as { name?: string }).name === "legacy-tool-result"
      ).length,
      0,
      "a provider-executed v1 result must not fall back to the legacy custom path",
    );
  });

  it("replays a provider-executed call streamed through the live lifecycle adapter", () => {
    // The live adapter defers tool announcement and synthesizes its own
    // `tool-input-start` without the provider marker, supplying it on
    // `tool-input-available` and the result instead, so an encoder that read the
    // marker off the start chunk alone would persist an unmarked call. Drive the
    // real lifecycle -> live -> encoder -> reader path end to end.
    const live = createStreamLifecycleLiveAdapter({});
    const chunks = frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "live-fetch",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_content",
          toolCallId: "live-fetch",
          delta: '{"url":"https://docs.example/page"}',
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "live-fetch",
          toolName: "web_fetch",
          input: { url: "https://docs.example/page" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "live-fetch",
          toolName: "web_fetch",
          output: { ok: true },
          isError: false,
          providerExecuted: true,
        },
      },
    ]).flatMap((frame) => live.encode(frame));

    assertEquals(
      chunks.find((chunk) => chunk.type === "tool-input-start"),
      { type: "tool-input-start", toolCallId: "live-fetch", toolName: "web_fetch" },
      "the live adapter must still synthesize an unmarked start for this regression to bite",
    );

    const stored = normalizeEncodedConversationRunEvents(chunks);
    assertEquals(
      stored.find((event) => event.type === "TOOL_CALL_END")?.providerExecuted,
      true,
      "the encoder must persist a provider marker that arrived after the tool start",
    );

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: stored,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ).map((frame) => frame.event),
      [{
        type: "provider_tool_result",
        toolCallId: "live-fetch",
        toolName: "web_fetch",
        output: { ok: true },
        isError: false,
        providerExecuted: true,
      }],
      "a live-streamed provider call must replay as a provider tool result",
    );
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "custom" &&
        (frame.event as { name?: string }).name === "legacy-tool-result"
      ).length,
      0,
      "a live-marked provider result must not fall back to the legacy custom path",
    );
  });

  it("keeps a result-only provider marker on the version 1 compatibility path", () => {
    // The version 2 writer marks provider execution on the result alone. The
    // lifecycle reducer only admits a provider start for a call that was itself
    // recorded as provider-executed, so inferring the marker from the result
    // would turn benign legacy history into a protocol failure.
    const stored = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "v2-fetch",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "v2-fetch",
          toolName: "web_fetch",
          input: { url: "https://docs.example/page" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "v2-fetch",
          toolName: "web_fetch",
          output: { ok: true },
          isError: false,
          providerExecuted: true,
        },
      },
    ]));

    assertEquals(
      stored.find((event) => event.type === "TOOL_CALL_START")?.providerExecuted,
      undefined,
      "the version 2 writer records no provider marker on the tool call start",
    );
    assertEquals(
      stored.find((event) => event.type === "TOOL_CALL_RESULT")?.providerExecuted,
      true,
      "the version 2 writer marks provider execution on the result",
    );

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: stored,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "custom" &&
        (frame.event as { name?: string }).name === "legacy-tool-result"
      ).length,
      1,
      "a result-only marker must stay on the legacy custom compatibility path",
    );
    assertEquals(
      result.frames.filter((frame) => frame.event.type === "provider_part_rejected").length,
      0,
      "replaying a result-only marker must never raise a protocol rejection",
    );
  });

  it("keeps a version 1 tool output that cannot be JSON encoded verbatim", () => {
    // `JSON.stringify` throws on a bigint, so the writer falls back to
    // `String(value)`. That rendering is itself valid JSON text, so an unmarked
    // fallback would decode back into a number that cannot hold the value.
    const stored = normalizeEncodedConversationRunEvents([
      {
        type: "tool-input-start",
        toolCallId: "legacy-count",
        toolName: "counter",
        providerExecuted: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "legacy-count",
        toolName: "counter",
        input: {},
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "legacy-count",
        output: 9007199254740993n,
        providerExecuted: true,
      },
    ]);

    const storedResult = stored.find((event) => event.type === "TOOL_CALL_RESULT");
    assertEquals(
      storedResult?.content,
      "9007199254740993",
      "the writer must fall back to the textual rendering of an unencodable value",
    );
    assertEquals(
      storedResult?.contentEncoding,
      "text",
      "the unencodable fallback must be marked as text so readers never decode it",
    );

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events: stored,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ).map((frame) => (frame.event as { output?: unknown }).output),
      ["9007199254740993"],
      "the textual fallback must replay verbatim rather than as an imprecise number",
    );
  });

  it("keeps an unmarked version 1 tool result on the custom compatibility path", () => {
    const events = [
      {
        type: "TOOL_CALL_START",
        toolCallId: "legacy-local",
        toolCallName: "request_approval",
      },
      {
        type: "TOOL_CALL_ARGS",
        toolCallId: "legacy-local",
        delta: '{"message":"Continue?"}',
      },
      {
        type: "TOOL_CALL_END",
        toolCallId: "legacy-local",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "legacy-local",
        toolName: "request_approval",
        content: { approved: true },
        isError: false,
      },
    ];

    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.repairs,
      [],
      "an unmarked v1 call with a result must not be repaired",
    );
    assertEquals(
      result.frames.filter((frame) => frame.class === "semantic" && frame.event.type === "custom")
        .map((frame) => frame.event),
      [{
        type: "custom",
        name: "legacy-tool-result",
        data: {
          toolCallId: "legacy-local",
          toolName: "request_approval",
          content: { approved: true },
          isError: false,
        },
      }],
      "an unmarked v1 result stays on the legacy-tool-result compatibility path",
    );
  });

  it("rejects the same malformed sequence for version 2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: fixture.events.map((event, index) => ({
        ...event,
        stream_protocol_version: 2,
        logical_sequence: index + 1,
        idempotency_key: `fixture:${index + 1}`,
      })),
    });
    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("sanitizes unknown legacy events and tolerates frozen input", () => {
    const events = Object.freeze([
      Object.freeze({
        type: "FUTURE_EVENT",
        secret: "sentinel-token-abcdef",
      }),
    ]);
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 1,
      events,
    });
    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.map((frame) => frame.event.type),
      ["provider_part_rejected"],
    );
    assertEquals(
      JSON.stringify(result).includes("sentinel-token-abcdef"),
      false,
    );
  });

  it("rejects unsupported durable events for version 2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [{
        type: "FUTURE_EVENT",
        stream_protocol_version: 2,
        logical_sequence: 1,
        idempotency_key: "future:1",
      }],
    });
    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "UNSUPPORTED_DURABLE_EVENT");
    }
  });

  it("rejects version 2 reads of events that are not stamped version 2", () => {
    const cases = [
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          logical_sequence: 1,
          idempotency_key: "text:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          logical_sequence: 2,
          idempotency_key: "text:2",
        },
      ],
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 1,
          logical_sequence: 1,
          idempotency_key: "text:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 1,
          logical_sequence: 2,
          idempotency_key: "text:2",
        },
      ],
    ];

    for (const events of cases) {
      const result = readConversationRunLifecycleFrames({
        streamProtocolVersion: 2,
        events,
      });
      assertEquals(result.status, "invalid", "a v2 read must reject events not stamped v2");
      if (result.status === "invalid") {
        assertEquals(
          result.code,
          "VERSION_2_LIFECYCLE_VIOLATION",
          "an unstamped event is a lifecycle violation, not an unsupported event",
        );
      }
    }
  });

  it("rejects version 2 reads with non-increasing logical sequences", () => {
    const cases = [
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "sequence:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "sequence:2",
        },
      ],
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "sequence:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "sequence:2",
        },
      ],
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1.5,
          idempotency_key: "sequence:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "sequence:2",
        },
      ],
      [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          idempotency_key: "sequence:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "sequence:2",
        },
      ],
    ];

    for (const events of cases) {
      const result = readConversationRunLifecycleFrames({
        streamProtocolVersion: 2,
        events,
      });
      assertEquals(
        result.status,
        "invalid",
        "version 2 reads must reject non-increasing logical sequences",
      );
      if (result.status === "invalid") {
        assertEquals(
          result.code,
          "VERSION_2_LIFECYCLE_VIOLATION",
          "an out-of-order sequence is a lifecycle violation",
        );
      }
    }
  });

  it("rejects replayed version 2 events that reuse an idempotency key", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "dup:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "dup:1",
        },
      ],
    });

    assertEquals(
      result.status,
      "invalid",
      "a repeated idempotency key must be rejected, not projected twice",
    );
    if (result.status === "invalid") {
      assertEquals(
        result.code,
        "VERSION_2_LIFECYCLE_VIOLATION",
        "a replayed durable event is a lifecycle violation",
      );
    }
  });

  it("rejects version 2 events without an idempotency key", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TEXT_MESSAGE_START",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "",
        },
        {
          type: "TEXT_MESSAGE_END",
          contentId: "text-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "",
        },
      ],
    });

    assertEquals(
      result.status,
      "invalid",
      "an event without an idempotency key must be rejected",
    );
    if (result.status === "invalid") {
      assertEquals(
        result.code,
        "VERSION_2_LIFECYCLE_VIOLATION",
        "a missing idempotency key is a lifecycle violation",
      );
    }
  });

  it("rejects version 2 durable events with missing lifecycle identities", () => {
    const cases = [
      [
        {
          type: "TEXT_MESSAGE_START",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "text:1",
        },
        {
          type: "TEXT_MESSAGE_END",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "text:2",
        },
      ],
      [
        {
          type: "TOOL_CALL_START",
          toolName: "get_file",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_END",
          toolName: "get_file",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
      ],
      [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool-name:1",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool-name:2",
        },
      ],
    ];

    for (const events of cases) {
      const result = readConversationRunLifecycleFrames({
        streamProtocolVersion: 2,
        events,
      });
      assertEquals(result.status, "invalid");
      if (result.status === "invalid") {
        assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
      }
    }
  });

  it("preserves stored version 2 tool arguments when replaying a committed call", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          toolName: "create_file",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool-1",
          delta: '{"path":"a.md"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          toolName: "create_file",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:3",
        },
      ],
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    const ready = result.frames.find((frame) =>
      frame.class === "semantic" && frame.event.type === "tool_input_ready"
    );
    assertEquals(ready?.event, {
      type: "tool_input_ready",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "a.md" },
    });
  });

  it("round trips provider-executed success results through durable v2 as AG-UI tool results", () => {
    const durableEvents = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "provider-1",
          toolName: "web_search",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "provider-1",
          toolName: "web_search",
          input: { query: "weather" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-1",
          toolName: "web_search",
          output: { forecast: "sunny" },
          isError: false,
          providerExecuted: true,
        },
      },
    ]));

    const storedResult = durableEvents.find((event) => event.type === "TOOL_CALL_RESULT");
    assertEquals(storedResult?.providerExecuted, true);
    const aguiEvents = projectDurableEventsToAgUi(durableEvents);
    assertEquals(
      aguiEvents.filter((event) => event.event === "ToolCallResult"),
      [{
        event: "ToolCallResult",
        payload: { toolCallId: "provider-1", result: { forecast: "sunny" } },
      }],
    );
  });

  it("rejects result-only provider tool history instead of repairing v2", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [{
        type: "TOOL_CALL_RESULT",
        toolCallId: "provider-1",
        toolName: "web_search",
        content: '{"answer":42}',
        isError: false,
        providerExecuted: true,
        stream_protocol_version: 2,
        logical_sequence: 1,
        idempotency_key: "tool:1",
      }],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects provider-executed v2 tool results before the tool lifecycle completes", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-open",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:open:start",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-open",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:open:result",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects provider-executed v2 tool results after malformed tool input", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-bad",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:bad:start",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "provider-bad",
          delta: '{"query":',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:bad:args",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "provider-bad",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:bad:end",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-bad",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:bad:result",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("rejects duplicate provider-executed v2 tool results", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:dupe:start",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "provider-dupe",
          delta: '{"query":"weather"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:dupe:args",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:dupe:end",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          content: '{"answer":42}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:dupe:result:1",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "provider-dupe",
          toolName: "web_search",
          content: '{"answer":43}',
          isError: false,
          providerExecuted: true,
          stream_protocol_version: 2,
          logical_sequence: 5,
          idempotency_key: "tool:dupe:result:2",
        },
      ],
    });

    assertEquals(result.status, "invalid");
    if (result.status === "invalid") {
      assertEquals(result.code, "VERSION_2_LIFECYCLE_VIOLATION");
    }
  });

  it("round trips provider-executed structured errors through durable v2", () => {
    const diagnostic = {
      error: "invalid_skill",
      code: "invalid_skill",
      message: "Skill validation failed",
      request_id: "request-123",
    };
    const durableEvents = writeDurableEvents(frames([
      {
        event: {
          type: "tool_input_start",
          toolCallId: "provider-err",
          toolName: "web_search",
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "tool_input_ready",
          toolCallId: "provider-err",
          toolName: "web_search",
          input: { query: "weather" },
          providerExecuted: true,
        },
      },
      {
        event: {
          type: "provider_tool_result",
          toolCallId: "provider-err",
          toolName: "web_search",
          output: diagnostic,
          isError: true,
          providerExecuted: true,
        },
      },
    ]));

    const storedResult = durableEvents.find((event) => event.type === "TOOL_CALL_RESULT");
    assertEquals(storedResult?.providerExecuted, true);
    const aguiEvents = projectDurableEventsToAgUi(durableEvents);
    assertEquals(
      aguiEvents.filter((event) => event.event === "ToolCallResult"),
      [{
        event: "ToolCallResult",
        payload: {
          toolCallId: "provider-err",
          result: diagnostic,
          isError: true,
        },
      }],
    );
  });

  it("keeps unmarked version 2 tool results on the custom compatibility path", () => {
    const result = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          type: "TOOL_CALL_START",
          toolCallId: "tool-1",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "tool:1",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool-1",
          delta: '{"query":"weather"}',
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "tool:2",
        },
        {
          type: "TOOL_CALL_END",
          toolCallId: "tool-1",
          toolName: "web_search",
          stream_protocol_version: 2,
          logical_sequence: 3,
          idempotency_key: "tool:3",
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tool-1",
          toolName: "web_search",
          content: "legacy",
          isError: false,
          stream_protocol_version: 2,
          logical_sequence: 4,
          idempotency_key: "tool:4",
        },
      ],
    });

    assertEquals(result.status, "ok");
    if (result.status !== "ok") return;
    assertEquals(
      result.frames.filter((frame) =>
        frame.class === "semantic" && frame.event.type === "provider_tool_result"
      ),
      [],
    );
    const agui = createLifecycleAgUiAdapter({ messageId: "message-1" });
    const aguiEvents = result.frames.flatMap((frame) => agui.encode(frame));
    assertEquals(
      aguiEvents.filter((event) => event.event === "Custom"),
      [{
        event: "Custom",
        payload: {
          name: "tool-call-result",
          value: {
            toolCallId: "tool-1",
            toolName: "web_search",
            content: "legacy",
            isError: false,
          },
        },
      }],
    );
  });
});
