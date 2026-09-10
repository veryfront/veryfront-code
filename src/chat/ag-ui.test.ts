import { ensureTestSchemaValidator } from "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { unregister } from "#veryfront/extensions/contracts.ts";
import {
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
} from "#veryfront/agent/ag-ui/host-support.ts";
// Test-only imports from the agent tree: this file is not part of the
// client bundle graph that `deno task lint:client-bundle` audits, so these
// pin the decoder's copied wire-name and timing-stamp-field lists against
// their sources of truth without widening the browser bundle.
import {
  buildDocumentCitedEvent,
  buildFileAttachedEvent,
  buildUrlCitedEvent,
  NATIVE_RUN_EVENTS,
} from "#veryfront/agent/ag-ui/native-run-events.ts";
import { formatAgUiEvent } from "#veryfront/internal-agents/ag-ui-sse.ts";
import { AG_UI_EVENT_TIMING_STAMP_FIELDS } from "#veryfront/agent/ag-ui/encoder.ts";
import { readConversationRunLifecycleFrames } from "#veryfront/agent/conversation/legacy-run-read-adapter.ts";
import {
  createAgUiChatEventDecoderState,
  decodeAgUiSseChunk,
  flushAgUiSseChunk,
  getAgUiWireEventNameSchema,
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
  for (const schemaBacked of [true, false]) {
    for (const validationMode of ["strict", "permissive"] as const) {
      it(`accepts optional tool names with schema=${schemaBacked} in ${validationMode} mode`, () => {
        ensureTestSchemaValidator();
        const frames = [{}, { toolCallName: null }, { toolCallName: "create_file" }].map(
          (name) => {
            const payload = { toolCallId: "tool-1", status: "pending_input", ...name };
            return {
              payload,
              wire: new TextDecoder().decode(formatAgUiEvent("ToolCallStatusChanged", payload)),
            };
          },
        );
        if (!schemaBacked) unregister("SchemaValidator");
        try {
          for (const { payload, wire } of frames) {
            const state = createAgUiChatEventDecoderState({ validationMode });
            assertEquals(
              decodeAgUiSseChunk(state, wire).events.flatMap((entry) => entry.chatEvents),
              [{ type: "data-tool-call-status", data: payload }],
            );
          }
          const invalid = 'event: ToolCallStatusChanged\ndata: {"toolCallId":"tool-1",' +
            '"status":"pending_input","toolCallName":42}\n\n';
          const decodeInvalid = () =>
            decodeAgUiSseChunk(
              createAgUiChatEventDecoderState({ validationMode }),
              invalid,
            );
          if (validationMode === "strict") assertThrows(decodeInvalid);
          else assertEquals(decodeInvalid().events, []);
        } finally {
          ensureTestSchemaValidator();
        }
      });
    }
  }

  it("decodes native run event frames into the chunks their custom twins produced", () => {
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: ToolCallStatusChanged\ndata: {"toolCallId":"tool-1","toolCallName":"create_file",' +
      '"status":"pending_input"}\n\n',
      'event: UrlCited\ndata: {"sourceId":"web-1","url":"https://example.com/a","title":"A"}\n\n',
      'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
      '"title":"Report"}\n\n',
      'event: FileAttached\ndata: {"url":"https://cdn.example.com/a.pdf",' +
      '"mediaType":"application/pdf"}\n\n',
      'event: InputRequestCreated\ndata: {"inputRequest":{"id":"req-1"}}\n\n',
      'event: InputRequestUpdated\ndata: {"inputRequest":{"id":"req-1"}}\n\n',
      'event: ChildRunStatusChanged\ndata: {"toolCallId":"t","childRunId":"r",' +
      '"status":"running"}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", toolCallName: "create_file", status: "pending_input" },
      },
      { type: "source-url", sourceId: "web-1", url: "https://example.com/a", title: "A" },
      { type: "source-document", sourceId: "doc-1", mediaType: "text/markdown", title: "Report" },
      { type: "file", url: "https://cdn.example.com/a.pdf", mediaType: "application/pdf" },
      {
        type: "data-veryfront.input_request.lifecycle",
        data: { action: "created", inputRequest: { id: "req-1" } },
      },
      {
        type: "data-veryfront.input_request.lifecycle",
        data: { action: "updated", inputRequest: { id: "req-1" } },
      },
      {
        type: "data-veryfront.invoke_agent.lifecycle",
        data: { toolCallId: "t", childRunId: "r", status: "running" },
      },
    ]);
  });

  it("falls back to a data chunk when an attachment cannot render", () => {
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    // toRenderableCustomChunk returned null for a file with no url, and the
    // Custom arm fell through to a data chunk. The native FileAttached arm
    // does the same: unlike DocumentCited's title (falls back to the source
    // id, since ChatSourceDocumentUiPart.title is required) or UrlCited's
    // title (optional, simply omitted), a url has no safe non-empty
    // fallback -- a placeholder would be an actively misleading, possibly
    // broken link -- so a missing one still has to fall back to the raw
    // chunk instead. See "treats a chunk's empty file url the same as a
    // missing one" for the encoder-to-decoder round trip, and "still
    // renders a citation despite the encoder dropping its empty title" for
    // DocumentCited/UrlCited's fallback instead.
    //
    // The Custom twin's fallback `data` is the whole original chunk object,
    // which still carries its own `type` (e.g. "file") because that object
    // is what toRenderableCustomChunk received as `value` before it
    // returned null. The native wire payload never carries that field — the
    // encoder's `toFrame` strips it, since the AG-UI event name already
    // names the chunk type — so the fallback here restores it to stay
    // byte-identical to the twin's fallback chunk.
    const frames = [
      'event: FileAttached\ndata: {"mediaType":"application/pdf","filename":"a.pdf"}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      {
        type: "data-file",
        data: { type: "file", mediaType: "application/pdf", filename: "a.pdf" },
      },
    ]);
  });

  it("accepts empty-string title and filename like the legacy custom mapping", () => {
    ensureTestSchemaValidator();
    // The native builders drop an empty title/filename/url before either
    // wire shape ever carries it (native-run-events.ts's
    // omitInvalidOptionalStrings, I1), so this scenario is unreachable from
    // this producer today -- but a
    // replayed or hand-built frame could still carry a literal empty string,
    // and the legacy `Custom` twin only ever checked
    // `typeof value.title === "string"`, with no length requirement, so the
    // native decoder must stay lenient and accept it too instead of
    // dropping the whole frame or substituting a fallback for a value that
    // is, unlike an absent one, present and valid as far as this decoder is
    // concerned.
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
      '"title":"","filename":""}\n\n',
      'event: FileAttached\ndata: {"mediaType":"application/pdf","url":"","filename":""}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      {
        type: "source-document",
        sourceId: "doc-1",
        mediaType: "text/markdown",
        title: "",
        filename: "",
      },
      { type: "file", url: "", mediaType: "application/pdf", filename: "" },
    ]);
  });

  it("still renders a citation despite the encoder dropping its empty title", () => {
    // Encoder-to-decoder round trip, not a hand-built frame like the tests
    // above and below: buildDocumentCitedEvent/buildUrlCitedEvent drop an
    // empty title from the one payload both shapes share (I1), so the live
    // wire frame never carries it either -- the citation still has to
    // render as if it had one. DocumentCited's decoder case falls back to
    // the citation's own source id because ChatSourceDocumentUiPart.title is
    // required; UrlCited's does the same for consistency, even though its
    // own title is optional and an absent one would otherwise just be
    // omitted.
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });

    const documentFrame = buildDocumentCitedEvent({
      type: "source-document",
      sourceId: "doc-1",
      mediaType: "text/markdown",
      title: "",
    }).live;
    const urlFrame = buildUrlCitedEvent({
      type: "source-url",
      sourceId: "web-1",
      url: "https://example.com/a",
      title: "",
    }).live;
    const frames = [
      `event: ${documentFrame.event}\ndata: ${JSON.stringify(documentFrame.payload)}\n\n`,
      `event: ${urlFrame.event}\ndata: ${JSON.stringify(urlFrame.payload)}\n\n`,
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      { type: "source-document", sourceId: "doc-1", mediaType: "text/markdown", title: "doc-1" },
      { type: "source-url", sourceId: "web-1", url: "https://example.com/a", title: "web-1" },
    ]);
  });

  it("still renders a replayed citation despite the durable record dropping its empty title", () => {
    // Compatibility-replay round trip, not the live wire frame like the test
    // above: a durable DOCUMENT_CITED/URL_CITED record with an empty title
    // (native-run-events.ts drops it, I1) gets read back by
    // legacy-run-read-adapter.ts as a legacy `Custom`-wrapped twin
    // (`{type: "custom", name, data}` lifecycle frames). Encoding that
    // straight back into a live AG-UI wire event re-natives it through
    // buildNativeRunEventFrame (lifecycle-adapter.ts's own "custom" case),
    // which exercises the same native decoder arm the test above already
    // covers -- so this constructs the literal `Custom` wire frame the twin
    // itself represents instead, the shape a compatibility reader that does
    // NOT re-native would emit. That goes through this decoder's `Custom`
    // arm and toRenderableCustomChunk (ag-ui-helpers.ts), a completely
    // different code path from the native arms' own title fallback. Both
    // paths must fall back to the source id the same way, or a citation
    // that rendered live disappears under compatibility replay.
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });

    const documentDurable = buildDocumentCitedEvent({
      type: "source-document",
      sourceId: "doc-1",
      mediaType: "text/markdown",
      title: "",
    }).durable;
    const urlDurable = buildUrlCitedEvent({
      type: "source-url",
      sourceId: "web-1",
      url: "https://example.com/a",
      title: "",
    }).durable;
    const read = readConversationRunLifecycleFrames({
      streamProtocolVersion: 2,
      events: [
        {
          ...documentDurable,
          stream_protocol_version: 2,
          logical_sequence: 1,
          idempotency_key: "replay:document",
        },
        {
          ...urlDurable,
          stream_protocol_version: 2,
          logical_sequence: 2,
          idempotency_key: "replay:url",
        },
      ],
    });
    assertEquals(read.status, "ok");
    if (read.status !== "ok") return;

    const customTwins = read.frames
      .map((frame) => frame.event)
      .filter((event): event is { type: "custom"; name: string; data: unknown } =>
        event.type === "custom"
      );
    assertEquals(customTwins.length, 2, "both records must read back as Custom twins");

    const frames = customTwins
      .map((twin) =>
        `event: Custom\ndata: ${JSON.stringify({ name: twin.name, value: twin.data })}\n\n`
      )
      .join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      { type: "source-document", sourceId: "doc-1", mediaType: "text/markdown", title: "doc-1" },
      { type: "source-url", sourceId: "web-1", url: "https://example.com/a", title: "web-1" },
    ]);
  });

  it("treats a chunk's empty file url the same as a missing one", () => {
    // buildFileAttachedEvent drops an empty url from the one payload both
    // shapes share (I1), so it never reaches the wire as "" -- once encoded,
    // a chunk whose url was originally empty is indistinguishable from one
    // that never had a url at all, and the FileAttached decoder case falls
    // back to a raw data-file chunk for both, exactly as
    // toRenderableCustomChunk did for the legacy Custom wrapper's `file`
    // value with no url.
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });

    const emptyUrlFrame = buildFileAttachedEvent({
      type: "file",
      mediaType: "application/pdf",
      url: "",
    }).live;
    const noUrlFrame = buildFileAttachedEvent({
      type: "file",
      mediaType: "application/pdf",
    }).live;
    const frames = [
      `event: ${emptyUrlFrame.event}\ndata: ${JSON.stringify(emptyUrlFrame.payload)}\n\n`,
      `event: ${noUrlFrame.event}\ndata: ${JSON.stringify(noUrlFrame.payload)}\n\n`,
    ].join("");

    const decoded = decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents);
    assertEquals(
      decoded[0],
      { type: "data-file", data: { type: "file", mediaType: "application/pdf" } },
    );
    assertEquals(decoded[0], decoded[1], "an empty url and a missing url must decode identically");
  });

  it("tolerates a null optional field the way the legacy custom mapping did", () => {
    ensureTestSchemaValidator();
    // This decoder must tolerate title/filename/url arriving on the wire as
    // an explicit null, the way a replayed or hand-built frame still could
    // even though the native builders now drop one (omitInvalidOptionalStrings,
    // I1), because the legacy `Custom` twin's `typeof value.field === "string"`
    // guard never rejected a null value outright — it just omitted the
    // field. A renderable citation or
    // attachment with a null filename must still render, a null title on a
    // DocumentCited falls back to the source id the same way an absent one
    // does, and a null field on an otherwise-unrenderable FileAttached must
    // not be dropped from the fallback data either.
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
      '"title":"Report","filename":null}\n\n',
      'event: FileAttached\ndata: {"url":"https://cdn.example.com/a.pdf",' +
      '"mediaType":"application/pdf","filename":null}\n\n',
      'event: DocumentCited\ndata: {"sourceId":"doc-2","mediaType":"text/markdown",' +
      '"title":null}\n\n',
      'event: FileAttached\ndata: {"mediaType":"application/pdf","filename":null}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      { type: "source-document", sourceId: "doc-1", mediaType: "text/markdown", title: "Report" },
      { type: "file", url: "https://cdn.example.com/a.pdf", mediaType: "application/pdf" },
      { type: "source-document", sourceId: "doc-2", mediaType: "text/markdown", title: "doc-2" },
      {
        type: "data-file",
        data: { type: "file", mediaType: "application/pdf", filename: null },
      },
    ]);
  });

  it("drops a non-string URL citation title instead of leaking it into the chat event", () => {
    ensureTestSchemaValidator();
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const result = decodeAgUiSseChunk(
      state,
      'event: UrlCited\ndata: {"sourceId":"web-1","url":"https://example.com/a",' +
        '"title":{"unexpected":true}}\n\n',
    );

    assertEquals(result.events.flatMap((entry) => entry.chatEvents), [
      { type: "source-url", sourceId: "web-1", url: "https://example.com/a" },
    ]);
  });

  it("keeps the Custom twin's URL citation title behavior consistent with the native decoder", () => {
    // Regression guard: toRenderableCustomChunk (ag-ui-helpers.ts) decodes
    // the reconstructed CUSTOM twin a replayed native URL_CITED record
    // produces, while this decoder's own UrlCited case decodes the live
    // wire frame -- both must resolve title the same way for the same
    // logical value (absent falls back to the source id; present-but-wrong-typed
    // is dropped; a real string is kept), or a citation renders differently
    // depending on whether it was seen live or replayed.
    ensureTestSchemaValidator();

    for (const title of [undefined, null, 42, { unexpected: true }, "Reference"]) {
      const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
      const nativePayload: Record<string, unknown> = {
        sourceId: "web-1",
        url: "https://example.com/a",
      };
      const customValue: Record<string, unknown> = {
        type: "source-url",
        sourceId: "web-1",
        url: "https://example.com/a",
      };
      if (title !== undefined) {
        nativePayload.title = title;
        customValue.title = title;
      }

      const frames = [
        `event: UrlCited\ndata: ${JSON.stringify(nativePayload)}\n\n`,
        `event: Custom\ndata: ${JSON.stringify({ name: "source-url", value: customValue })}\n\n`,
      ].join("");

      const [nativeEvent, customEvent] = decodeAgUiSseChunk(state, frames).events.flatMap((
        entry,
      ) => entry.chatEvents);
      assertEquals(
        customEvent,
        nativeEvent,
        `native and Custom decoding must agree for title ${JSON.stringify(title)}`,
      );
    }
  });

  it("falls back to the url as sourceId for a URL citation missing one", () => {
    ensureTestSchemaValidator();
    // toRenderableCustomChunk falls back to url when sourceId is absent or
    // empty. This producer's buildUrlCitedEvent always sets sourceId, so
    // this is unreachable today, but a replayed or hand-built frame must
    // still match the twin instead of throwing in strict mode.
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: UrlCited\ndata: {"url":"https://example.com/a"}\n\n',
      'event: UrlCited\ndata: {"sourceId":"","url":"https://example.com/b"}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      {
        type: "source-url",
        sourceId: "https://example.com/a",
        url: "https://example.com/a",
        title: "https://example.com/a",
      },
      {
        type: "source-url",
        sourceId: "https://example.com/b",
        url: "https://example.com/b",
        title: "https://example.com/b",
      },
    ]);
  });

  it("renders or falls back on a wrong-typed optional field instead of rejecting the frame", () => {
    ensureTestSchemaValidator();
    // The encoder never type-checks title/filename/url before sending them,
    // so a wrong-typed value (not just null) must not reject the whole
    // frame either: the legacy `Custom` twin only ever asked
    // `typeof value.field === "string"` when deciding how to render.
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
      '"title":"Report","filename":42}\n\n',
      'event: FileAttached\ndata: {"url":"https://cdn.example.com/a.pdf",' +
      '"mediaType":"application/pdf","filename":42}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      { type: "source-document", sourceId: "doc-1", mediaType: "text/markdown", title: "Report" },
      { type: "file", url: "https://cdn.example.com/a.pdf", mediaType: "application/pdf" },
    ]);
  });

  it("strips live encoder timing stamps out of reconstructed legacy data payloads", () => {
    ensureTestSchemaValidator();
    // stampAgUiEventTiming (encoder.ts) stamps elapsedMs/emittedAt onto a
    // native frame's own flat payload once a real clock is configured. A
    // Custom frame's payload is `{ name, value }`, so the stamp lands beside
    // `value` and the twin's decoded chunk never carried these two fields --
    // reusing a native frame's whole payload as legacy `data` must not leak
    // them in either.
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const frames = [
      'event: ToolCallStatusChanged\ndata: {"toolCallId":"tool-1","toolCallName":"create_file",' +
      '"status":"pending_input","elapsedMs":42,"emittedAt":1757400000000}\n\n',
      'event: ChildRunStatusChanged\ndata: {"toolCallId":"t","childRunId":"r",' +
      '"status":"running","elapsedMs":42,"emittedAt":1757400000000}\n\n',
      'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
      '"elapsedMs":42,"emittedAt":1757400000000}\n\n',
      'event: FileAttached\ndata: {"mediaType":"application/pdf","elapsedMs":42,' +
      '"emittedAt":1757400000000}\n\n',
    ].join("");

    assertEquals(decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents), [
      {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", toolCallName: "create_file", status: "pending_input" },
      },
      {
        type: "data-veryfront.invoke_agent.lifecycle",
        data: { toolCallId: "t", childRunId: "r", status: "running" },
      },
      {
        type: "source-document",
        sourceId: "doc-1",
        mediaType: "text/markdown",
        title: "doc-1",
      },
      {
        type: "data-file",
        data: { type: "file", mediaType: "application/pdf" },
      },
    ]);
  });

  it("decodes every native run event wire name NATIVE_RUN_EVENTS defines", () => {
    ensureTestSchemaValidator();
    // NATIVE_RUN_EVENTS (src/agent/ag-ui/native-run-events.ts) is the
    // producer's source of truth for the seven native wire names; this
    // decoder keeps its own copy in AG_UI_WIRE_EVENT_NAMES rather than
    // importing that module, to keep the agent tree off the client bundle
    // graph. Nothing else catches the two lists drifting apart: an eighth
    // native type added there would be silently dropped here, which is the
    // exact failure P9 exists to prevent.
    for (const { wireName } of NATIVE_RUN_EVENTS) {
      const parsed = getAgUiWireEventNameSchema().safeParse(wireName);
      assertEquals(
        parsed.success,
        true,
        `AG_UI_WIRE_EVENT_NAMES in src/chat/ag-ui.ts is missing native wire name "${wireName}"; ` +
          "add it there or this decoder silently drops the frame",
      );
    }
  });

  it("keeps its timing-stamp strip list in sync with the encoder's stamped fields", () => {
    ensureTestSchemaValidator();
    // AG_UI_EVENT_TIMING_STAMP_FIELDS (src/agent/ag-ui/encoder.ts) names
    // every field stampAgUiEventTiming stamps onto a live event's flat
    // payload. The decoder's stripAgUiTimingStamps re-hardcodes that same
    // list so it can strip them from a reconstructed legacy data chunk; this
    // drives every stamped field through the decoder and asserts none of
    // them survive, so a third stamped field added later fails a test
    // instead of leaking into `data` the way elapsedMs/emittedAt already
    // did once on the durable-record read path (commit 3ee902fb12).
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    const stampedFields = Object.fromEntries(
      AG_UI_EVENT_TIMING_STAMP_FIELDS.map((field) => [field, 1]),
    );
    const payload = JSON.stringify({
      toolCallId: "tool-1",
      toolCallName: "create_file",
      status: "pending_input",
      ...stampedFields,
    });
    const result = decodeAgUiSseChunk(
      state,
      `event: ToolCallStatusChanged\ndata: ${payload}\n\n`,
    );

    const [event] = result.events.flatMap((entry) => entry.chatEvents);
    assertExists(event);
    const data = (event as { data: Record<string, unknown> }).data;
    for (const field of AG_UI_EVENT_TIMING_STAMP_FIELDS) {
      assertEquals(
        Object.hasOwn(data, field),
        false,
        `stripAgUiTimingStamps in src/chat/ag-ui.ts must also strip "${field}"`,
      );
    }
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

  it("decodes native run event frames through the hand-rolled validator too", () => {
    // The seven native arms in isValidAgUiPayload only run on this path, so
    // the zod-backed coverage above does not exercise them at all. Reuse the
    // same seven-frame string the schema-validated twin-equality test uses.
    unregister("SchemaValidator");
    try {
      const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
      const frames = [
        'event: ToolCallStatusChanged\ndata: {"toolCallId":"tool-1","toolCallName":"create_file",' +
        '"status":"pending_input"}\n\n',
        'event: UrlCited\ndata: {"sourceId":"web-1","url":"https://example.com/a","title":"A"}\n\n',
        'event: DocumentCited\ndata: {"sourceId":"doc-1","mediaType":"text/markdown",' +
        '"title":"Report"}\n\n',
        'event: FileAttached\ndata: {"url":"https://cdn.example.com/a.pdf",' +
        '"mediaType":"application/pdf"}\n\n',
        'event: InputRequestCreated\ndata: {"inputRequest":{"id":"req-1"}}\n\n',
        'event: InputRequestUpdated\ndata: {"inputRequest":{"id":"req-1"}}\n\n',
        'event: ChildRunStatusChanged\ndata: {"toolCallId":"t","childRunId":"r",' +
        '"status":"running"}\n\n',
      ].join("");

      assertEquals(
        decodeAgUiSseChunk(state, frames).events.flatMap((entry) => entry.chatEvents),
        [
          {
            type: "data-tool-call-status",
            data: { toolCallId: "tool-1", toolCallName: "create_file", status: "pending_input" },
          },
          { type: "source-url", sourceId: "web-1", url: "https://example.com/a", title: "A" },
          {
            type: "source-document",
            sourceId: "doc-1",
            mediaType: "text/markdown",
            title: "Report",
          },
          { type: "file", url: "https://cdn.example.com/a.pdf", mediaType: "application/pdf" },
          {
            type: "data-veryfront.input_request.lifecycle",
            data: { action: "created", inputRequest: { id: "req-1" } },
          },
          {
            type: "data-veryfront.input_request.lifecycle",
            data: { action: "updated", inputRequest: { id: "req-1" } },
          },
          {
            type: "data-veryfront.invoke_agent.lifecycle",
            data: { toolCallId: "t", childRunId: "r", status: "running" },
          },
        ],
        "the hand-rolled validator must decode native frames the same way the zod schema does",
      );
    } finally {
      ensureTestSchemaValidator();
    }
  });
});
