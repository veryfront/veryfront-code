import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgUiChatEventDecoderState,
  decodeAgUiSseChunk,
  flushAgUiSseChunk,
  getAgUiRunFinishedMetadataSchema,
  getAgUiSnapshotMessageSchema,
  mapAgUiRuntimeMessagesToChatUiMessages,
  parseSseEvent,
} from "./ag-ui.ts";
import { formatToolErrorText, toRenderableCustomChunk } from "./ag-ui-helpers.ts";

describe("chat/ag-ui", () => {
  it("does not execute accessors while formatting errors or custom chunks", () => {
    let getterCalls = 0;
    const error: Record<string, unknown> = { code: "failed" };
    Object.defineProperty(error, "message", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("untrusted error getter");
      },
    });
    const customChunk: Record<string, unknown> = { type: "source-url" };
    Object.defineProperty(customChunk, "url", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("untrusted URL getter");
      },
    });

    assertEquals(formatToolErrorText(error), '{"code":"failed"}');
    assertEquals(toRenderableCustomChunk(customChunk), null);
    assertEquals(getterCalls, 0);
  });

  it("keeps the global error snapshot entry budget across nested arrays", () => {
    let descriptorReads = 0;
    const trackDescriptors = (target: unknown[]) =>
      new Proxy(target, {
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === "string" && /^\d+$/u.test(key)) descriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
    const inner = trackDescriptors(new Array(1_000).fill(null));
    const outerValues = new Array(1_000).fill(null);
    outerValues[0] = inner;
    const outer = trackDescriptors(outerValues);

    formatToolErrorText({ nested: outer });

    assertEquals(descriptorReads <= 1_000, true);
  });

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
      { type: "text-start", id: "text:0", messageId: "msg-1", contentId: "text:0" },
      {
        type: "text-delta",
        id: "text:0",
        messageId: "msg-1",
        contentId: "text:0",
        delta: "Hello",
      },
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
      id: "text:0",
      messageId: "msg-1",
      contentId: "text:0",
      delta: "partial",
    }]);
    assertEquals(flushed.remainder, "");
  });

  it("flushes a frame that exactly reaches the configured buffer limit", () => {
    const frame = 'event: Custom\ndata: {"name":"progress","value":1}';
    const state = createAgUiChatEventDecoderState({
      maxBufferedChars: frame.length,
      maxFrameChars: frame.length,
    });

    assertEquals(decodeAgUiSseChunk(state, frame).events, []);
    assertEquals(flushAgUiSseChunk(state).events[0]?.chatEvents, [
      { type: "data-progress", data: 1 },
    ]);
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
      { type: "text-start", id: "block-1", messageId: "msg-1", contentId: "block-1" },
      {
        type: "text-delta",
        id: "block-1",
        messageId: "msg-1",
        contentId: "block-1",
        delta: "hello",
      },
      { type: "text-end", id: "block-1", messageId: "msg-1", contentId: "block-1" },
    ]);
  });

  it("ignores duplicate and malformed frames while advancing the SSE cursor", () => {
    const state = createAgUiChatEventDecoderState({ lastEventId: 2 });
    const result = decodeAgUiSseChunk(
      state,
      [
        "id: 2",
        "event: TextMessageContent",
        'data: {"messageId":"msg-1","delta":"old"}',
        "",
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

    assertEquals(result.events, []);
    assertEquals(state.lastEventId, 4);
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

  it("rejects unsafe run metadata and inconsistent decoder limits", () => {
    const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
    assertThrows(
      () =>
        decodeAgUiSseChunk(
          state,
          'event: RunStarted\ndata: {"agent_avatar_url":"javascript:alert(1)"}\n\n',
        ),
      Error,
      "Malformed AG-UI event payload for RunStarted",
    );
    assertThrows(
      () => createAgUiChatEventDecoderState({ maxBufferedChars: 10, maxFrameChars: 11 }),
      RangeError,
      "maxFrameChars must not exceed maxBufferedChars",
    );
  });

  it("validates nested snapshot, state-delta, and finish metadata payloads", () => {
    assertEquals(
      getAgUiRunFinishedMetadataSchema().safeParse({
        inputTokens: Number.MAX_SAFE_INTEGER + 1,
      }).success,
      false,
    );
    assertEquals(
      getAgUiSnapshotMessageSchema().safeParse({ id: "", role: "assistant" }).success,
      false,
    );
    for (
      const frame of [
        'event: MessagesSnapshot\ndata: {"messages":[42]}\n\n',
        'event: StateDelta\ndata: {"delta":[{"op":"add","path":""}]}\n\n',
        'event: RunFinished\ndata: {"metadata":{"inputTokens":-1}}\n\n',
      ]
    ) {
      const state = createAgUiChatEventDecoderState({ validationMode: "strict" });
      assertThrows(
        () => decodeAgUiSseChunk(state, frame),
        Error,
        "Malformed AG-UI event payload",
      );
    }
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

  it("redacts untrusted AG-UI run error details", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: RunError\ndata: {"code":"PROVIDER_ERROR","message":"request <REDACTED> failed at internal host"}\n\n',
    );

    assertEquals(result.events[0]?.chatEvents, [{
      type: "error",
      errorText: "Conversation agent run failed",
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

  it("keeps an explicit reasoning id for later id-less lifecycle events", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        "event: ReasoningMessageStart",
        'data: {"id":"reasoning-1"}',
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

    assertEquals(result.events.flatMap((entry) => entry.chatEvents), [
      { type: "reasoning-start", id: "reasoning-1" },
      { type: "reasoning-delta", id: "reasoning-1", delta: "Thinking" },
      { type: "reasoning-end", id: "reasoning-1" },
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

  it("does not promote unsafe custom URLs into renderable links", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      'event: Custom\ndata: {"name":"source","value":{"type":"source-url","sourceId":"src-1","url":"javascript:alert(1)"}}\n\n',
    );

    assertEquals(result.events[0]?.chatEvents, [{
      type: "data-source",
      data: { type: "source-url", sourceId: "src-1", url: "javascript:alert(1)" },
    }]);
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

  it("emits an orphan ToolCallResult without inventing a tool input event", () => {
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
        type: "tool-output-available",
        toolCallId: "tool-1",
        output: { success: true },
        providerExecuted: true,
      },
    ]);
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

  it("maps runtime tool errors and drops orphan tool results without inventing tool names", () => {
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
    ]);
  });

  it("does not attach a delayed runtime tool result across a user turn", () => {
    const result = mapAgUiRuntimeMessagesToChatUiMessages([
      {
        id: "assistant-1",
        role: "assistant",
        toolCalls: [{
          id: "tool-call-1",
          type: "function",
          function: { name: "search_files", arguments: "{}" },
        }],
      },
      { id: "user-2", role: "user", content: "Start a new turn" },
      {
        id: "late-tool-result",
        role: "tool",
        toolCallId: "tool-call-1",
        content: '{"matches":2}',
      },
    ]);

    assertEquals(result, [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "search_files",
          toolCallId: "tool-call-1",
          input: {},
          state: "input-available",
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Start a new turn" }],
      },
    ]);
  });

  it("keeps distinct text content blocks separate under one assistant message", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        'event: TextMessageStart\ndata: {"messageId":"msg-1","contentId":"block-1"}',
        'event: TextMessageContent\ndata: {"messageId":"msg-1","contentId":"block-1","delta":"first"}',
        'event: TextMessageEnd\ndata: {"messageId":"msg-1","contentId":"block-1"}',
        'event: TextMessageStart\ndata: {"messageId":"msg-1","contentId":"block-2"}',
        'event: TextMessageContent\ndata: {"messageId":"msg-1","contentId":"block-2","delta":"second"}',
        'event: TextMessageEnd\ndata: {"messageId":"msg-1","contentId":"block-2"}',
      ].join("\n\n") + "\n\n",
    );

    assertEquals(
      result.events.flatMap((event) => event.chatEvents).map((event) =>
        "id" in event ? event.id : null
      ),
      ["block-1", "block-1", "block-1", "block-2", "block-2", "block-2"],
    );
  });

  it("bounds incomplete SSE frames before buffering untrusted streams", () => {
    const state = createAgUiChatEventDecoderState({ maxBufferedChars: 32 });

    assertThrows(
      () => decodeAgUiSseChunk(state, "x".repeat(33)),
      Error,
      "AG-UI SSE buffer exceeds 32 characters",
    );
    assertEquals(state.remainder, "");
  });

  it("releases completed tool state and does not fabricate an orphan tool start", () => {
    const state = createAgUiChatEventDecoderState();
    const result = decodeAgUiSseChunk(
      state,
      [
        'event: ToolCallStart\ndata: {"toolCallId":"tool-1","toolCallName":"search"}',
        'event: ToolCallEnd\ndata: {"toolCallId":"tool-1"}',
        'event: ToolCallResult\ndata: {"toolCallId":"tool-1","content":"{\\"ok\\":true}"}',
        'event: ToolCallResult\ndata: {"toolCallId":"orphan","input":{"q":"x"},"content":"{\\"ok\\":true}"}',
      ].join("\n\n") + "\n\n",
    );

    assertEquals(state.toolCalls.size, 0);
    assertEquals(result.events[1]?.chatEvents, [{
      type: "tool-input-available",
      toolCallId: "tool-1",
      toolName: "search",
      input: {},
      providerExecuted: true,
    }]);
    assertEquals(result.events.at(-1)?.chatEvents, [{
      type: "tool-output-available",
      toolCallId: "orphan",
      output: { ok: true },
      providerExecuted: true,
    }]);
  });

  it("rejects empty, fractional, and unsafe SSE sequence ids", () => {
    assertEquals(parseSseEvent("id:\nevent: Custom\ndata: {}\n").id, null);
    assertEquals(parseSseEvent("id: 1.5\nevent: Custom\ndata: {}\n").id, null);
    assertEquals(
      parseSseEvent(`id: ${Number.MAX_SAFE_INTEGER + 1}\nevent: Custom\ndata: {}\n`).id,
      null,
    );
  });
});
