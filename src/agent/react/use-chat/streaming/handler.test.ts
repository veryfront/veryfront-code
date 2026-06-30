import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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
    assertExists(toolPart);
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
        errorText: undefined,
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
});
