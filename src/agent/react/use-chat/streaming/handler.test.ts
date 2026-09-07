import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleAgUiStreamingResponse, handleStreamingResponse } from "./handler.ts";
import type { StreamingCallbacks } from "./types.ts";
import type { ChatMessage, ChatMessagePart, OnToolCallArg } from "../types.ts";

/**
 * Build a ReadableStream that emits each event as an SSE `data:` frame,
 * exactly as the streaming handler expects to parse. Splitting frames across
 * chunks is intentional in some tests to exercise the line buffering.
 */
function sseStream(events: unknown[], chunkSplitter?: (sse: string) => string[]): ReadableStream {
  const encoder = new TextEncoder();
  const sse = events.map((e) => `data: ${JSON.stringify(e)}\n`).join("");
  const chunks = chunkSplitter ? chunkSplitter(sse) : [sse];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function agUiSseStream(
  events: Array<{ event: string; data: unknown }>,
  chunkSplitter?: (sse: string) => string[],
): ReadableStream {
  const encoder = new TextEncoder();
  const sse = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  const chunks = chunkSplitter ? chunkSplitter(sse) : [sse];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

interface Recorder {
  callbacks: StreamingCallbacks;
  messages: ChatMessage[];
  data: unknown[];
  toolCalls: OnToolCallArg[];
  updates: { parts: ChatMessagePart[]; messageId: string; metadata?: ChatMessage["metadata"] }[];
}

function recorder(): Recorder {
  const messages: ChatMessage[] = [];
  const data: unknown[] = [];
  const toolCalls: OnToolCallArg[] = [];
  const updates: {
    parts: ChatMessagePart[];
    messageId: string;
    metadata?: ChatMessage["metadata"];
  }[] = [];
  return {
    messages,
    data,
    toolCalls,
    updates,
    callbacks: {
      onMessage: (m) => messages.push(m),
      onData: (d) => data.push(d),
      onUpdate: (parts, messageId, metadata) => updates.push({ parts, messageId, metadata }),
      onToolCall: (arg) => toolCalls.push(arg),
    },
  };
}

describe("use-chat streaming handler", () => {
  it("assembles a text message across deltas and emits it on finish", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-1" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Hello" },
        { type: "text-delta", id: "t1", delta: ", world" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.messages.length, 1);
    const msg = rec.messages[0]!;
    assertEquals(msg.id, "msg-1");
    assertEquals(msg.role, "assistant");
    const textParts = msg.parts.filter((p) => p.type === "text");
    assertEquals(textParts.length, 1);
    assertEquals((textParts[0] as { text: string }).text, "Hello, world");

    // Each text-delta drives an onUpdate with the running message id.
    assert(rec.updates.length >= 2);
    assertEquals(rec.updates.at(-1)!.messageId, "msg-1");
  });

  it("supports the textDelta field alias for deltas", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", textDelta: "abc" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );
    const textPart = rec.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "abc");
  });

  it("drives a full tool-call lifecycle to a result part", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-tool" },
        { type: "tool-input-start", toolCallId: "c1", toolName: "search" },
        { type: "tool-input-delta", toolCallId: "c1", delta: '{"q":' },
        { type: "tool-input-delta", toolCallId: "c1", delta: '"hi"}' },
        {
          type: "tool-input-available",
          toolCallId: "c1",
          toolName: "search",
          input: { q: "hi" },
        },
        { type: "tool-output-available", toolCallId: "c1", output: { hits: 2 } },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    // onToolCall fires once with the resolved input.
    assertEquals(rec.toolCalls.length, 1);
    assertEquals(rec.toolCalls[0]!.toolCall.toolName, "search");
    assertEquals(rec.toolCalls[0]!.toolCall.input, { q: "hi" });

    // The built parts include the tool call (output-available) in the final message.
    const msg = rec.messages[0]!;
    const toolPart = msg.parts.find((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
    assertEquals(toolPart, {
      type: "tool-search",
      toolCallId: "c1",
      toolName: "search",
      state: "output-available",
      input: { q: "hi" },
      output: { hits: 2 },
    }, "the streamed tool output must reach the final message part");
  });

  it("emits dynamic-tool calls through onToolCall with the dynamic flag", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        {
          type: "tool-input-available",
          toolCallId: "d1",
          toolName: "mcp_tool",
          input: { x: 1 },
          dynamic: true,
        },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );
    assertEquals(rec.toolCalls.length, 1);
    assertEquals(rec.toolCalls[0]!.toolCall.dynamic, true);

    const message = rec.messages[0];
    assertExists(message);
    assertEquals(message.parts, [
      {
        type: "dynamic-tool",
        toolCallId: "d1",
        toolName: "mcp_tool",
        state: "input-available",
        input: { x: 1 },
      },
    ], "dynamic tool calls render as dynamic-tool parts");
  });

  it("preserves providerExecuted on provider-owned input-only tool parts", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-provider-tool" },
        {
          type: "tool-input-start",
          toolCallId: "provider-fetch",
          toolName: "web_fetch",
          providerExecuted: true,
        },
        {
          type: "tool-input-available",
          toolCallId: "provider-fetch",
          toolName: "web_fetch",
          input: { url: "https://example.com/docs" },
          providerExecuted: true,
        },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.toolCalls[0]!.toolCall, {
      toolCallId: "provider-fetch",
      toolName: "web_fetch",
      input: { url: "https://example.com/docs" },
      dynamic: false,
    });
    const message = rec.messages[0];
    assertExists(message);
    assertEquals(message.parts, [
      {
        type: "tool-web_fetch",
        toolCallId: "provider-fetch",
        toolName: "web_fetch",
        state: "input-available",
        input: { url: "https://example.com/docs" },
        providerExecuted: true,
      },
    ]);
  });

  it("assembles reasoning blocks across deltas", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "think " },
        { type: "reasoning-delta", id: "r1", delta: "more" },
        { type: "reasoning-end", id: "r1", signature: "sig_123" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );
    const reasoning = rec.messages[0]!.parts.find((p) => p.type === "reasoning");
    assertExists(reasoning);
    assertEquals((reasoning as { text: string }).text, "think more");
    assertEquals((reasoning as { state: string }).state, "done");
    assertEquals((reasoning as { signature: string }).signature, "sig_123");
  });

  it("forwards data events using data field then value fallback", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "data", data: { a: 1 } },
        { type: "data", value: { b: 2 } },
      ]),
      rec.callbacks,
    );
    assertEquals(rec.data, [{ a: 1 }, { b: 2 }]);
  });

  it("ignores custom data events without a JSON payload", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-custom-data" },
        { type: "data-missing" },
        { type: "data-null", data: null },
        { type: "data-false", data: false },
        { type: "data-zero", data: 0 },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.data, [null, false, 0]);
    assertEquals(rec.messages[0]?.parts, [
      { type: "data-null", data: null },
      { type: "data-false", data: false },
      { type: "data-zero", data: 0 },
    ]);
  });

  it("upserts a child-agent stream into one durable message part", async () => {
    const rec = recorder();
    const childEvents = Array.from({ length: 1_001 }, (_, index) => ({
      type: "data-veryfront.invoke_agent.stream",
      data: {
        toolCallId: "parent-invoke",
        agentId: "case-ingest",
        event: { type: "text-delta", id: "child-text", delta: String(index % 10) },
      },
    }));

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-child-stream" },
        ...childEvents,
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    const childParts = rec.messages[0]!.parts.filter((part) =>
      part.type === "data-veryfront.invoke_agent.stream"
    );
    assertEquals(childParts.length, 1);
    assertEquals(
      (childParts[0] as {
        data: { events: Array<{ type: string; id: string; delta: string }> };
      }).data.events,
      [{
        type: "text-delta",
        id: "child-text",
        delta: Array.from({ length: 1_001 }, (_, index) => String(index % 10)).join(""),
      }],
    );
  });

  it("skips malformed JSON lines without throwing", async () => {
    const encoder = new TextEncoder();
    const rec = recorder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not valid json}\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text-start", id: "t1" })}\n`),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: "ok" })}\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text-end", id: "t1" })}\n`),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "message-finish" })}\n`),
        );
        controller.close();
      },
    });
    await handleStreamingResponse(stream, rec.callbacks);
    const textPart = rec.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "ok");
  });

  it("parses events split across chunk boundaries via the line buffer", async () => {
    const rec = recorder();
    // Split mid-frame so the handler must buffer the partial line.
    const stream = sseStream(
      [
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "split" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ],
      (sse) => {
        const mid = Math.floor(sse.length / 2);
        return [sse.slice(0, mid), sse.slice(mid)];
      },
    );
    await handleStreamingResponse(stream, rec.callbacks);
    const textPart = rec.messages[0]!.parts.find((p) => p.type === "text");
    assertEquals((textPart as { text: string }).text, "split");
  });

  it("does not emit a message when there are no parts", async () => {
    const rec = recorder();
    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "empty" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );
    assertEquals(rec.messages.length, 0);
  });

  it("flushes a final frame that arrives without a trailing newline", async () => {
    const rec = recorder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (
          const event of [
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "tail" },
            { type: "text-end", id: "t1" },
          ]
        ) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`));
        }
        // Deliberately no trailing newline: the final frame only reaches the
        // handler through the leftover-buffer flush after the read loop.
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "message-finish" })}`));
        controller.close();
      },
    });

    await handleStreamingResponse(stream, rec.callbacks);

    assertEquals(
      rec.messages.length,
      1,
      "a stream whose final frame lacks a trailing newline still emits its message",
    );
    assertEquals(
      (rec.messages[0]!.parts.find((p) => p.type === "text") as { text: string }).text,
      "tail",
      "the assembled text survives the leftover-buffer flush",
    );
  });

  it("rejects and unlocks the body when the AG-UI run reports an error", async () => {
    const body = agUiSseStream([
      { event: "RunStarted", data: { runId: "run-1" } },
      { event: "RunError", data: { message: "Runtime failed" } },
    ]);

    const error = await assertRejects(
      () => handleAgUiStreamingResponse(body, recorder().callbacks),
      Error,
      "Runtime failed",
      "an AG-UI run error must surface to the caller instead of being swallowed",
    );
    assert(error instanceof Error);
    assertEquals(Object.hasOwn(error, "code"), false, "code-free errors stay code-free");
    assertEquals(
      body.locked,
      false,
      "the finally block must release the reader lock when an event handler throws",
    );
  });

  it("preserves an AG-UI terminal code without changing error registry identity", async () => {
    const error = await assertRejects(
      () =>
        handleAgUiStreamingResponse(
          agUiSseStream([
            {
              event: "RunError",
              data: { code: "INSUFFICIENT_CREDITS", message: "Purchase additional credits." },
            },
          ]),
          recorder().callbacks,
        ),
      Error,
      "Purchase additional credits.",
    );
    assert(error instanceof Error);

    const terminalError = error as Error & { code?: string; slug?: string; status?: number };
    assertEquals(terminalError.code, "INSUFFICIENT_CREDITS");
    assertEquals(terminalError.slug, "agent-error");
    assertEquals(terminalError.status, 500);
  });

  it("maps AG-UI tool-call args and results through the default stream handler", async () => {
    const rec = recorder();
    await handleAgUiStreamingResponse(
      agUiSseStream([
        {
          event: "ToolCallStart",
          data: { toolCallId: "tool-1", toolCallName: "lookupDocs" },
        },
        {
          event: "ToolCallArgs",
          data: { toolCallId: "tool-1", delta: '{"query":' },
        },
        {
          event: "ToolCallArgs",
          data: { toolCallId: "tool-1", delta: '"agents"}' },
        },
        { event: "ToolCallEnd", data: { toolCallId: "tool-1" } },
        {
          event: "ToolCallResult",
          data: {
            toolCallId: "tool-1",
            result: { count: 2 },
          },
        },
        { event: "RunFinished", data: { metadata: { finishReason: "stop" } } },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.toolCalls.length, 1);
    assertEquals(rec.toolCalls[0]!.toolCall, {
      toolCallId: "tool-1",
      toolName: "lookupDocs",
      input: { query: "agents" },
      dynamic: false,
    });

    const message = rec.messages[0];
    assertExists(message);
    assert(message.id.startsWith("msg-"));
    assertEquals(message.parts, [
      {
        type: "tool-lookupDocs",
        toolCallId: "tool-1",
        toolName: "lookupDocs",
        state: "output-available",
        input: { query: "agents" },
        output: { count: 2 },
        providerExecuted: true,
      },
    ]);
  });

  it("attaches AG-UI run metadata to the assistant message", async () => {
    const rec = recorder();
    await handleAgUiStreamingResponse(
      agUiSseStream([
        {
          event: "RunStarted",
          data: {
            runId: "run-1",
            agentId: "support-agent",
            agentName: "Support Agent",
            agent_avatar_url: "https://cdn.example.com/agents/support.svg",
          },
        },
        {
          event: "TextMessageStart",
          data: { messageId: "agui-msg", contentId: "text:0", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          data: { messageId: "agui-msg", contentId: "text:0", delta: "Hello" },
        },
        {
          event: "TextMessageEnd",
          data: { messageId: "agui-msg", contentId: "text:0" },
        },
        { event: "RunFinished", data: {} },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.messages.length, 1);
    assertEquals(rec.messages[0]!.metadata, {
      agentId: "support-agent",
      agentName: "Support Agent",
      agentAvatarUrl: "https://cdn.example.com/agents/support.svg",
      runId: "run-1",
    });
    assertEquals(rec.updates.at(-1)?.metadata, {
      agentId: "support-agent",
      agentName: "Support Agent",
      agentAvatarUrl: "https://cdn.example.com/agents/support.svg",
      runId: "run-1",
    });
  });

  it("flushes AG-UI events split across chunk boundaries", async () => {
    const rec = recorder();
    await handleAgUiStreamingResponse(
      agUiSseStream(
        [
          {
            event: "TextMessageStart",
            data: { messageId: "agui-msg", contentId: "text:0", role: "assistant" },
          },
          {
            event: "TextMessageContent",
            data: { messageId: "agui-msg", contentId: "text:0", delta: "split" },
          },
          {
            event: "TextMessageEnd",
            data: { messageId: "agui-msg", contentId: "text:0" },
          },
          { event: "RunFinished", data: {} },
        ],
        (sse) => {
          const splitAt = sse.indexOf("split");
          return [sse.slice(0, splitAt + 2), sse.slice(splitAt + 2)];
        },
      ),
      rec.callbacks,
    );

    assertEquals(rec.messages.length, 1);
    assertEquals(rec.messages[0]!.id, "agui-msg");
    assertEquals(rec.messages[0]!.parts, [
      { type: "text", text: "split", state: "done" },
    ]);
  });

  it("keeps a step-2 reasoning block after the step-1 tool calls when the provider reuses the reasoning id", async () => {
    const rec = recorder();
    const reasoningId = "msg-abc:reasoning:reasoning-0";

    await handleAgUiStreamingResponse(
      agUiSseStream([
        { event: "RunStarted", data: { runId: "run-1", threadId: "t-1" } },
        { event: "StepStarted", data: { stepName: "step-1" } },
        { event: "ReasoningMessageStart", data: { messageId: reasoningId, role: "reasoning" } },
        {
          event: "ReasoningMessageContent",
          data: { messageId: reasoningId, delta: "first thought" },
        },
        { event: "ReasoningMessageEnd", data: { messageId: reasoningId } },
        { event: "ToolCallStart", data: { toolCallId: "call-1", toolCallName: "calculator" } },
        { event: "ToolCallArgs", data: { toolCallId: "call-1", delta: '{"a":1}' } },
        { event: "ToolCallEnd", data: { toolCallId: "call-1" } },
        { event: "ToolCallResult", data: { toolCallId: "call-1", result: { result: 1 } } },
        { event: "StepFinished", data: { stepName: "step-1" } },
        { event: "StepStarted", data: { stepName: "step-2" } },
        { event: "ReasoningMessageStart", data: { messageId: reasoningId, role: "reasoning" } },
        {
          event: "ReasoningMessageContent",
          data: { messageId: reasoningId, delta: "second thought" },
        },
        { event: "ReasoningMessageEnd", data: { messageId: reasoningId } },
        {
          event: "TextMessageStart",
          data: { messageId: "msg-abc", contentId: "text-0", role: "assistant" },
        },
        {
          event: "TextMessageContent",
          data: { messageId: "msg-abc", contentId: "text-0", delta: "answer" },
        },
        { event: "TextMessageEnd", data: { messageId: "msg-abc", contentId: "text-0" } },
        { event: "RunFinished", data: {} },
      ]),
      rec.callbacks,
    );

    const parts = rec.messages[0]!.parts.filter((part) =>
      part.type === "reasoning" || part.type.startsWith("tool-") || part.type === "text"
    );

    assertEquals(
      parts.map((
        part,
      ) => (part.type === "reasoning"
        ? `reasoning:${(part as { text: string }).text}`
        : part.type)
      ),
      [
        "reasoning:first thought",
        "tool-calculator",
        "reasoning:second thought",
        "text",
      ],
    );
  });

  it("keeps text and position when a still-open reasoning span restarts", async () => {
    const rec = recorder();

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-replay" },
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: "partial" },
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-delta", id: "r1", delta: " more" },
        { type: "reasoning-end", id: "r1" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "answer" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.messages[0]!.parts, [
      { type: "reasoning", text: "partial more", state: "done" },
      { type: "text", text: "answer", state: "done" },
    ]);
  });

  it("keeps a step-2 answer after the step-1 text when the provider reuses the text id", async () => {
    const rec = recorder();

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-text-reuse" },
        { type: "text-start", id: "text-0" },
        { type: "text-delta", id: "text-0", delta: "first answer" },
        { type: "text-end", id: "text-0" },
        { type: "tool-input-start", toolCallId: "call-1", toolName: "calculator" },
        {
          type: "tool-input-available",
          toolCallId: "call-1",
          toolName: "calculator",
          input: { a: 1 },
        },
        { type: "tool-output-available", toolCallId: "call-1", output: { result: 1 } },
        { type: "text-start", id: "text-0" },
        { type: "text-delta", id: "text-0", delta: "second answer" },
        { type: "text-end", id: "text-0" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(
      rec.messages[0]!.parts.map((part) =>
        part.type === "text" ? `text:${(part as { text: string }).text}` : part.type
      ),
      ["text:first answer", "tool-calculator", "text:second answer"],
    );
  });

  it("keeps text and position when a still-open text block restarts", async () => {
    const rec = recorder();

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-text-replay" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "partial" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: " more" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.messages[0]!.parts, [
      { type: "text", text: "partial more", state: "done" },
    ]);
  });

  it("keeps a reasoning span that closed without content, for the renderer to drop", async () => {
    const rec = recorder();

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-empty-reasoning" },
        // A step that produced no reasoning still opens and closes the span.
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-end", id: "reasoning-0" },
        { type: "reasoning-start", id: "reasoning-0" },
        { type: "reasoning-delta", id: "reasoning-0", delta: "real thinking" },
        { type: "reasoning-end", id: "reasoning-0" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "answer" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    // Assembly stays faithful to the stream: AG-UI sent two reasoning messages,
    // so the message carries two. Suppressing the empty one is a display
    // decision, which the spec leaves to the consumer and `groupPartsInOrder`
    // makes — there, it also covers conversations loaded back from storage.
    assertEquals(rec.messages[0]!.parts, [
      { type: "reasoning", text: "", state: "done" },
      { type: "reasoning", text: "real thinking", state: "done" },
      { type: "text", text: "answer", state: "done" },
    ]);
  });

  it("keeps a redacted reasoning span that carries no visible text", async () => {
    const rec = recorder();

    await handleStreamingResponse(
      sseStream([
        { type: "message-start", messageId: "msg-redacted" },
        { type: "reasoning-start", id: "r1" },
        { type: "reasoning-end", id: "r1", redactedData: "opaque" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "answer" },
        { type: "text-end", id: "t1" },
        { type: "message-finish" },
      ]),
      rec.callbacks,
    );

    assertEquals(rec.messages[0]!.parts, [
      { type: "reasoning", text: "", redactedData: "opaque", state: "done" },
      { type: "text", text: "answer", state: "done" },
    ]);
  });
});
