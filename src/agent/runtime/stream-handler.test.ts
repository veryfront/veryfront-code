import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState, handleStreamEvent } from "./stream-handler.ts";
import type { StreamState as _StreamState } from "./stream-handler.ts";

function createMockController() {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
  } as unknown as ReadableStreamDefaultController;
  return { controller, chunks };
}

function decodeChunks(chunks: Uint8Array[]): Record<string, unknown>[] {
  const decoder = new TextDecoder();
  return chunks.map((c) => {
    const text = decoder.decode(c);
    // SSE format: data: {...}\n\n
    const json = text.replace(/^data:\s*/, "").trim();
    return JSON.parse(json);
  });
}

describe("stream-handler", () => {
  describe("createStreamState", () => {
    it("creates an empty initial state", () => {
      const state = createStreamState();
      assertEquals(state.accumulatedText, "");
      assertEquals(state.finishReason, null);
      assertEquals(state.toolCalls.size, 0);
    });
  });

  describe("handleStreamEvent", () => {
    const encoder = new TextEncoder();

    it("accumulates text from content events", () => {
      const state = createStreamState();
      const { controller } = createMockController();

      handleStreamEvent(
        { type: "content", content: "Hello " },
        state,
        controller,
        encoder,
        "text-1",
      );
      handleStreamEvent(
        { type: "content", content: "world" },
        state,
        controller,
        encoder,
        "text-1",
      );

      assertEquals(state.accumulatedText, "Hello world");
    });

    it("sends text-delta SSE for content events", () => {
      const state = createStreamState();
      const { controller, chunks } = createMockController();

      handleStreamEvent(
        { type: "content", content: "Hi" },
        state,
        controller,
        encoder,
        "text-1",
      );

      const events = decodeChunks(chunks);
      assertEquals(events.length, 1);
      assertEquals(events[0].type, "text-delta");
      assertEquals(events[0].delta, "Hi");
      assertEquals(events[0].id, "text-1");
    });

    it("invokes onChunk callback for content events", () => {
      const state = createStreamState();
      const { controller } = createMockController();
      const receivedChunks: string[] = [];

      handleStreamEvent(
        { type: "content", content: "data" },
        state,
        controller,
        encoder,
        undefined,
        { onChunk: (c) => receivedChunks.push(c) },
      );

      assertEquals(receivedChunks, ["data"]);
    });

    it("registers tool call on tool_call_start", () => {
      const state = createStreamState();
      const { controller } = createMockController();

      handleStreamEvent(
        { type: "tool_call_start", toolCall: { id: "tc1", name: "search", index: 0 } },
        state,
        controller,
        encoder,
        undefined,
      );

      assertEquals(state.toolCalls.size, 1);
      const tc = state.toolCalls.get("tc1")!;
      assertEquals(tc.name, "search");
      assertEquals(tc.arguments, "");
    });

    it("accumulates tool arguments on tool_call_delta", () => {
      const state = createStreamState();
      const { controller } = createMockController();

      // First register the tool call
      state.toolCalls.set("tc1", { id: "tc1", name: "search", arguments: "" });

      handleStreamEvent(
        { type: "tool_call_delta", id: "tc1", index: 0, arguments: '{"q":' },
        state,
        controller,
        encoder,
        undefined,
      );
      handleStreamEvent(
        { type: "tool_call_delta", id: "tc1", index: 0, arguments: '"hello"}' },
        state,
        controller,
        encoder,
        undefined,
      );

      assertEquals(state.toolCalls.get("tc1")!.arguments, '{"q":"hello"}');
    });

    it("sets tool call on tool_call_complete", () => {
      const state = createStreamState();
      const { controller } = createMockController();

      handleStreamEvent(
        {
          type: "tool_call_complete",
          toolCall: { id: "tc2", name: "calc", index: 0, arguments: '{"x":1}' },
        },
        state,
        controller,
        encoder,
        undefined,
      );

      assertEquals(state.toolCalls.size, 1);
      assertEquals(state.toolCalls.get("tc2")!.arguments, '{"x":1}');
    });

    it("sets finish reason on finish event", () => {
      const state = createStreamState();
      const { controller } = createMockController();

      handleStreamEvent(
        { type: "finish", finishReason: "tool_calls" },
        state,
        controller,
        encoder,
        undefined,
      );

      assertEquals(state.finishReason, "tool_calls");
    });

    it("invokes onUsage callback for usage events", () => {
      const state = createStreamState();
      const { controller } = createMockController();
      let receivedUsage: Record<string, unknown> | null = null;

      handleStreamEvent(
        { type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
        state,
        controller,
        encoder,
        undefined,
        {
          onUsage: (u) => {
            receivedUsage = u as unknown as Record<string, unknown>;
          },
        },
      );

      assertEquals(receivedUsage !== null, true);
      assertEquals((receivedUsage as Record<string, unknown>).promptTokens, 10);
    });

    it("ignores tool_call_start with no id", () => {
      const state = createStreamState();
      const { controller, chunks: _chunks } = createMockController();

      handleStreamEvent(
        { type: "tool_call_start", toolCall: { id: "", name: "x", index: 0 } } as Parameters<
          typeof handleStreamEvent
        >[0],
        state,
        controller,
        encoder,
        undefined,
      );

      // No tool call registered because id is falsy
      assertEquals(state.toolCalls.size, 0);
    });

    it("ignores tool_call_delta for unknown tool call", () => {
      const state = createStreamState();
      const { controller, chunks } = createMockController();

      handleStreamEvent(
        { type: "tool_call_delta", id: "unknown", index: 0, arguments: "data" },
        state,
        controller,
        encoder,
        undefined,
      );

      // Should not throw, just silently skip
      assertEquals(chunks.length, 0);
    });
  });
});
