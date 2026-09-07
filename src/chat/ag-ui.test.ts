import { ensureTestSchemaValidator } from "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { unregister } from "#veryfront/extensions/contracts.ts";
import {
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
} from "#veryfront/agent/ag-ui/host-support.ts";
import {
  createAgUiChatEventDecoderState,
  decodeAgUiSseChunk,
  flushAgUiSseChunk,
  mapAgUiRuntimeMessagesToChatUiMessages,
  parseSseEvent,
} from "./ag-ui.ts";

describe("chat/ag-ui", () => {
  it("keeps the public browser entrypoint off server-side data stream imports", async () => {
    const source = await Deno.readTextFile(new URL("./ag-ui.ts", import.meta.url));

    assertEquals(source.includes("#veryfront/agent/streaming/data-stream.ts"), false);
    assertEquals(source.includes("serverLogger"), false);
  });

  it("parses SSE frames with ids, events, and multi-line data", () => {
    const parsed = parseSseEvent(
      'id: 12\nevent: Custom\ndata: {"name":"alpha",\ndata: "value":1}\n',
    );

    assertEquals(parsed.id, 12);
    assertEquals(parsed.event, "Custom");
    assertEquals(parsed.data, '{"name":"alpha",\n"value":1}');
    assertEquals(parseSseEvent("id:\ndata: empty").id, null);
    assertEquals(parseSseEvent("id: -1\ndata: negative").id, null);
    assertEquals(parseSseEvent("id: 1.5\ndata: fractional").id, null);
    assertEquals(parseSseEvent("id: 0\ndata: valid").id, 0);
  });

  it("decodes AG-UI SSE chunks into canonical chat stream events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 1",
        "event: RunStarted",
        'data: {"runId":"run-1","threadId":"thread-1","agentId":"veryfront","agentName":"Veryfront","agent_avatar_url":"https://cdn.example.com/agents/veryfront.svg"}',
        "",
        "id: 2",
        "event: TextMessageStart",
        'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
        "",
        "id: 3",
        "event: TextMessageContent",
        'data: {"messageId":"msg-1","contentId":"text:0","delta":"Hello"}',
        "",
        "id: 4",
        "event: ToolCallStart",
        'data: {"toolCallId":"tool-1","toolCallName":"load_skill"}',
        "",
        "id: 5",
        "event: ToolCallArgs",
        'data: {"toolCallId":"tool-1","delta":"{}"}',
        "",
        "id: 6",
        "event: ToolCallArgs",
        'data: {"toolCallId":"tool-1","delta":"{\\"skillId\\":\\"plan\\"}"}',
        "",
        "id: 7",
        "event: ToolCallEnd",
        'data: {"toolCallId":"tool-1"}',
        "",
        "id: 8",
        "event: ToolCallResult",
        'data: {"toolCallId":"tool-1","result":"{\\"loaded\\":true}"}',
        "",
        "id: 9",
        "event: Custom",
        'data: {"name":"file","value":{"type":"file","url":"https://cdn.example.com/spec.md","mediaType":"text/markdown","filename":"spec.md"}}',
        "",
        "id: 10",
        "event: RunFinished",
        'data: {"metadata":{"finishReason":"stop"}}',
        "",
        "",
      ].join("\n"),
    );

    assertEquals(result.events.map((entry) => entry.eventId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assertEquals(state.lastEventId, 10);
    assertEquals(state.toolCalls.size, 0);
    assertEquals(result.remainder, "");

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      {
        type: "start",
        messageMetadata: {
          agentId: "veryfront",
          agentName: "Veryfront",
          agent_avatar_url: "https://cdn.example.com/agents/veryfront.svg",
          runId: "run-1",
          threadId: "thread-1",
        },
      },
      { type: "text-start", id: "msg-1", contentId: "text:0" },
      { type: "text-delta", id: "msg-1", contentId: "text:0", delta: "Hello" },
      {
        type: "tool-input-start",
        toolCallId: "tool-1",
        toolName: "load_skill",
        providerExecuted: true,
      },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "{}" },
      { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"skillId":"plan"}' },
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "load_skill",
        input: { skillId: "plan" },
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { loaded: true },
        providerExecuted: true,
      },
      {
        type: "file",
        url: "https://cdn.example.com/spec.md",
        mediaType: "text/markdown",
        filename: "spec.md",
      },
      { type: "finish", finishReason: "stop" },
    ]);
  });

  it("flushes a final AG-UI SSE frame without a trailing blank line", () => {
    const state = createAgUiChatEventDecoderState();
    const initial = decodeAgUiSseChunk(
      state,
      'id: 1\nevent: TextMessageContent\ndata: {"messageId":"msg-1","contentId":"text:0","delta":"partial"}',
    );

    assertEquals(initial.events, []);
    assertEquals(initial.remainder.length > 0, true);

    const flushed = flushAgUiSseChunk(state);
    assertEquals(flushed.events.map((entry) => entry.eventId), [1]);
    assertEquals(flushed.events[0]?.chatEvents, [{
      type: "text-delta",
      id: "msg-1",
      contentId: "text:0",
      delta: "partial",
    }]);
    assertEquals(flushed.remainder, "");
  });

  it("preserves an SSE CRLF pair split across transport chunks", () => {
    const state = createAgUiChatEventDecoderState();
    const initial = decodeAgUiSseChunk(
      state,
      "event: TextMessageContent\r",
    );

    assertEquals(initial.events, []);

    const completed = decodeAgUiSseChunk(
      state,
      '\ndata: {"messageId":"msg-1","contentId":"text:0","delta":"hello"}\r\n\r\n',
    );

    assertEquals(completed.events.length, 1);
    assertEquals(completed.events[0]?.chatEvents, [{
      type: "text-delta",
      id: "msg-1",
      contentId: "text:0",
      delta: "hello",
    }]);
    assertEquals(completed.remainder, "");
  });

  it("bounds incomplete and individual SSE frames", () => {
    assertThrows(
      () => createAgUiChatEventDecoderState({ maxFrameChars: 0 }),
      RangeError,
      "maxFrameChars",
    );

    const incomplete = createAgUiChatEventDecoderState({ maxFrameChars: 8 });
    assertThrows(
      () => decodeAgUiSseChunk(incomplete, "123456789"),
      RangeError,
      "maximum frame size",
    );

    const complete = createAgUiChatEventDecoderState({ maxFrameChars: 8 });
    assertThrows(
      () => decodeAgUiSseChunk(complete, "123456789\n\n"),
      RangeError,
      "maximum frame size",
    );
  });

  it("releases unfinished tool state when a run terminates", () => {
    const state = createAgUiChatEventDecoderState();
    decodeAgUiSseChunk(
      state,
      [
        "event: ToolCallStart",
        'data: {"toolCallId":"tool-1","toolCallName":"load_skill"}',
        "",
        "event: RunFinished",
        "data: {}",
        "",
        "",
      ].join("\n"),
    );

    assertEquals(state.toolCalls.size, 0);
  });

  it("exposes file metadata on the canonical UI chunk type", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: Custom\ndata: {"name":"attachment","value":{"type":"file","url":"https://cdn.example.com/report.pdf","mediaType":"application/pdf","filename":"report.pdf"}}\n\n',
    );

    assertEquals(
      result.events[0]?.chatEvents,
      [{
        type: "file",
        url: "https://cdn.example.com/report.pdf",
        mediaType: "application/pdf",
        filename: "report.pdf",
      }],
      "a Custom file event must decode to a file chat event with its filename",
    );
  });

  it("preserves AG-UI text content ids when decoding chat stream events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: TextMessageStart",
        'data: {"messageId":"msg-1","contentId":"block-1","role":"assistant"}',
        "",
        "event: TextMessageContent",
        'data: {"messageId":"msg-1","contentId":"block-1","delta":"hello"}',
        "",
        "event: TextMessageEnd",
        'data: {"messageId":"msg-1","contentId":"block-1"}',
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      { type: "text-start", id: "msg-1", contentId: "block-1" },
      { type: "text-delta", id: "msg-1", contentId: "block-1", delta: "hello" },
      { type: "text-end", id: "msg-1", contentId: "block-1" },
    ]);
  });

  it("ignores duplicate and malformed frames while advancing the SSE cursor", () => {
    const state = createAgUiChatEventDecoderState({ lastEventId: 2 });
    // The id: 2 frame is a fully valid TextMessageContent payload, so only the
    // replay guard can stop it from being emitted.
    const replayFrame = [
      "event: TextMessageContent",
      'data: {"messageId":"msg-1","contentId":"block-1","delta":"old"}',
      "",
    ];
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 2",
        ...replayFrame,
        "id: 3",
        "event: ToolCallStart",
        "data: not-json",
        "",
        "id: 4",
        "event: UnsupportedEvent",
        'data: {"foo":"bar"}',
        "",
        "",
      ].join("\n"),
    );

    assertEquals(
      result.events,
      [],
      "a frame at or below lastEventId must not be re-emitted",
    );
    assertEquals(state.lastEventId, 4);

    const replayed = decodeAgUiSseChunk(state, ["id: 5", ...replayFrame, ""].join("\n"));

    assertEquals(
      replayed.events[0]?.chatEvents,
      [{ type: "text-delta", id: "msg-1", contentId: "block-1", delta: "old" }],
      "the byte-identical frame above lastEventId must be emitted",
    );
  });

  it("reports invalid JSON frames in strict mode without throwing", () => {
    const invalidFrames: Array<{ eventName: string | null; dataLength: number }> = [];
    const state = createAgUiChatEventDecoderState({
      validationMode: "strict",
      onInvalidJson: (details) => invalidFrames.push(details),
    });
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 3",
        "event: ToolCallStart",
        "data: not-json",
        "",
        "",
      ].join("\n"),
    );

    assertEquals(result.events, []);
    assertEquals(state.lastEventId, 3);
    assertEquals(invalidFrames, [{ eventName: "ToolCallStart", dataLength: 8 }]);
  });

  it("throws on malformed handled payloads in strict mode", () => {
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });

    assertThrows(
      () =>
        decodeAgUiSseChunk(
          state,
          'id: 1\nevent: RunFinished\ndata: {"metadata":"bad"}\n\n',
        ),
      Error,
      "Malformed AG-UI event payload for RunFinished",
    );
  });

  it("throws on malformed trailing handled payloads when flushed in strict mode", () => {
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const initial = decodeAgUiSseChunk(
      state,
      'id: 1\nevent: RunFinished\ndata: {"metadata":"bad"}',
    );

    assertEquals(initial.events, []);
    assertEquals(initial.remainder.length > 0, true);

    assertThrows(
      () => flushAgUiSseChunk(state),
      Error,
      "Malformed AG-UI event payload for RunFinished",
    );
  });

  it("maps cancellation errors to abort events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: RunError\ndata: {"code":"CANCELLED","message":"Stopped"}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertEquals(result.events[0]?.chatEvents, [{ type: "abort" }]);
  });

  it("round-trips non-cancellation error codes through public AG-UI encode and decode", async () => {
    const response = createAgUiSseErrorResponse(
      createAgUiRunErrorEvent("Purchase additional credits.", "INSUFFICIENT_CREDITS"),
      402,
    );
    const result = decodeAgUiSseChunk(
      createAgUiChatEventDecoderState(),
      await response.text(),
    );

    assertEquals(result.events[0]?.chatEvents, [{
      type: "error",
      errorText: "Purchase additional credits.",
      code: "INSUFFICIENT_CREDITS",
    }]);

    const legacyResponse = createAgUiSseErrorResponse(
      createAgUiRunErrorEvent("Legacy failure"),
      500,
    );
    const legacyResult = decodeAgUiSseChunk(
      createAgUiChatEventDecoderState(),
      await legacyResponse.text(),
    );

    assertEquals(legacyResult.events[0]?.chatEvents, [{
      type: "error",
      errorText: "Legacy failure",
    }]);
  });

  it("keeps fallback reasoning ids stable across start, delta, and end", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ReasoningMessageStart",
        'data: {"role":"assistant"}',
        "",
        "event: ReasoningMessageContent",
        'data: {"delta":"Thinking"}',
        "",
        "event: ReasoningMessageEnd",
        "data: {}",
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      { type: "reasoning-start", id: "agui-reasoning:1" },
      { type: "reasoning-delta", id: "agui-reasoning:1", delta: "Thinking" },
      { type: "reasoning-end", id: "agui-reasoning:1" },
    ]);
    assertEquals(state.activeFallbackReasoningPartId, null);
  });

  it("preserves non-renderable custom events as data chunks", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: Custom\ndata: {"name":"progress","value":{"percent":42}}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertEquals(result.events[0]?.chatEvents, [
      { type: "data-progress", data: { percent: 42 } },
    ]);
  });

  it("emits tool output errors when AG-UI result payloads are marked as failures", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ToolCallStart",
        'data: {"toolCallId":"tool-err","toolCallName":"search"}',
        "",
        "event: ToolCallResult",
        'data: {"toolCallId":"tool-err","result":{"message":"No results"},"isError":true}',
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      {
        type: "tool-input-start",
        toolCallId: "tool-err",
        toolName: "search",
        providerExecuted: true,
      },
      {
        type: "tool-output-error",
        toolCallId: "tool-err",
        errorText: "No results",
        providerExecuted: true,
      },
    ]);
  });

  it("preserves ToolCallResult input when the result arrives without a prior tool start", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ToolCallResult",
        'data: {"toolCallId":"tool-1","input":{"path":"report.md","content":"hello"},"result":{"success":true}}',
        "",
        "",
      ].join("\n"),
    );

    const chatEvents = result.events.flatMap((entry) => entry.chatEvents);
    assertEquals(chatEvents, [
      {
        type: "tool-input-available",
        toolCallId: "tool-1",
        toolName: "tool",
        input: {
          path: "report.md",
          content: "hello",
        },
        dynamic: true,
        providerExecuted: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { success: true },
        providerExecuted: true,
      },
    ]);
  });

  it("parses complete JSON number grammar in serialized tool results", () => {
    const state = createAgUiChatEventDecoderState();
    const exponent = decodeAgUiSseChunk(
      state,
      'event: ToolCallResult\ndata: {"toolCallId":"tool-exponent","content":"1e3"}\n\n',
    );
    const leadingZero = decodeAgUiSseChunk(
      state,
      'event: ToolCallResult\ndata: {"toolCallId":"tool-leading-zero","content":"01"}\n\n',
    );

    assertEquals(exponent.events[0]?.chatEvents.at(-1), {
      type: "tool-output-available",
      toolCallId: "tool-exponent",
      output: 1_000,
      providerExecuted: true,
    });
    assertEquals(leadingZero.events[0]?.chatEvents.at(-1), {
      type: "tool-output-available",
      toolCallId: "tool-leading-zero",
      output: "01",
      providerExecuted: true,
    });
  });

  it("retains decoded wire events alongside canonical chat events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'id: 7\nevent: StateDelta\ndata: {"delta":{"phase":"planning"}}\n\n',
    );

    assertEquals(result.events.length, 1);
    assertExists(result.events[0]);
    assertEquals(result.events[0].eventId, 7);
    assertEquals(result.events[0].wireEvent.eventName, "StateDelta");
    assertEquals(result.events[0].chatEvents, [{
      type: "data-state-delta",
      data: { phase: "planning" },
    }]);
  });

  it("maps runtime-native messages into chat UI messages with tool results", () => {
    const result = mapAgUiRuntimeMessagesToChatUiMessages([
      {
        id: "system-1",
        role: "system",
        content: "Follow the project instructions",
      },
      {
        id: "user-1",
        role: "user",
        content: "Inspect the project first",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Trying a search",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: {
              name: "search_files",
              arguments: '{"query":"auth"}',
            },
          },
        ],
      },
      {
        id: "tool-1",
        role: "tool",
        toolCallId: "tool-call-1",
        content: '{"matches":2}',
      },
    ]);

    assertEquals(result, [
      {
        id: "system-1",
        role: "system",
        parts: [{ type: "text", text: "Follow the project instructions" }],
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Inspect the project first" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Trying a search" },
          {
            type: "dynamic-tool",
            toolName: "search_files",
            toolCallId: "tool-call-1",
            input: { query: "auth" },
            state: "output-available",
            output: { matches: 2 },
          },
        ],
      },
    ]);
  });

  it("maps runtime tool errors and orphan tool results into assistant tool parts", () => {
    const result = mapAgUiRuntimeMessagesToChatUiMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Working",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: {
              name: "search_files",
              arguments: "not-json",
            },
          },
        ],
      },
      {
        id: "tool-1",
        role: "tool",
        toolCallId: "tool-call-1",
        content: "ignored on error",
        error: "search failed",
      },
      {
        id: "tool-orphan",
        role: "tool",
        toolCallId: "missing-tool-call",
        content: '{"matches":2}',
      },
      {
        id: "assistant-empty",
        role: "assistant",
      },
    ]);

    assertEquals(result, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "text", text: "Working" },
          {
            type: "dynamic-tool",
            toolName: "search_files",
            toolCallId: "tool-call-1",
            input: { raw: "not-json" },
            state: "output-error",
            errorText: "search failed",
          },
        ],
      },
      {
        id: "tool-orphan",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "unknown",
            toolCallId: "missing-tool-call",
            input: {},
            state: "output-available",
            output: { matches: 2 },
          },
        ],
      },
    ]);
  });
});

describe("chat/ag-ui without a registered SchemaValidator", () => {
  // The browser chat client decodes AG-UI frames before any schema adapter is
  // registered, so the hand-rolled validator has to reach the same canonical
  // events the zod-backed schema produces.
  it("decodes the same canonical events through the hand-rolled validator", () => {
    unregister("SchemaValidator");
    try {
      const state = createAgUiChatEventDecoderState();
      const result = decodeAgUiSseChunk(
        state,
        [
          "event: RunStarted",
          'data: {"runId":"run-1","threadId":"thread-1","agentId":"veryfront","agentName":"Veryfront","agent_avatar_url":"https://cdn.example.com/agents/veryfront.svg"}',
          "",
          "event: TextMessageStart",
          'data: {"messageId":"msg-1","contentId":"text:0","role":"assistant"}',
          "",
          "event: TextMessageContent",
          'data: {"messageId":"msg-1","contentId":"text:0","delta":"Hello"}',
          "",
          "event: ToolCallStart",
          'data: {"toolCallId":"tool-1","toolCallName":"load_skill"}',
          "",
          "event: ToolCallArgs",
          'data: {"toolCallId":"tool-1","delta":"{}"}',
          "",
          "",
        ].join("\n"),
      );

      assertEquals(
        result.events.flatMap((entry) => entry.chatEvents),
        [
          {
            type: "start",
            messageMetadata: {
              agentId: "veryfront",
              agentName: "Veryfront",
              agent_avatar_url: "https://cdn.example.com/agents/veryfront.svg",
              runId: "run-1",
              threadId: "thread-1",
            },
          },
          { type: "text-start", id: "msg-1", contentId: "text:0" },
          { type: "text-delta", id: "msg-1", contentId: "text:0", delta: "Hello" },
          {
            type: "tool-input-start",
            toolCallId: "tool-1",
            toolName: "load_skill",
            providerExecuted: true,
          },
          { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "{}" },
        ],
        "schemaless decoding must produce the same canonical events",
      );
    } finally {
      ensureTestSchemaValidator();
    }
  });

  it("rejects a Custom frame that carries no value", () => {
    unregister("SchemaValidator");
    try {
      const state = createAgUiChatEventDecoderState();
      const result = decodeAgUiSseChunk(state, 'event: Custom\ndata: {"name":"progress"}\n\n');

      assertEquals(
        result.events,
        [],
        "Custom without value must be rejected by the hand-rolled validator",
      );
    } finally {
      ensureTestSchemaValidator();
    }
  });
});
