import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createStreamState, processStream } from "./ai-stream-handler.ts";

/**
 * Helper: collect SSE events from a ReadableStream controller.
 * Returns an array of parsed JSON events.
 */
function createSSECollector() {
  const events: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      const text = decoder.decode(chunk);
      // Parse "data: {...}\n\n" format
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        events.push(JSON.parse(line.slice(6)));
      }
    },
  } as unknown as ReadableStreamDefaultController;
  return { events, controller, encoder };
}

/**
 * Helper: create a mock StreamTextResult with a fullStream from chunks.
 */
function createMockResult(
  chunks: Record<string, unknown>[],
) {
  const fullStream = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
  return { fullStream } as Parameters<typeof processStream>[0];
}

describe("ai-stream-handler", () => {
  describe("createStreamState", () => {
    it("returns a clean initial state", () => {
      const state = createStreamState();
      assertEquals(state.accumulatedText, "");
      assertEquals(state.finishReason, null);
      assertEquals(state.toolCalls.size, 0);
      assertEquals(state.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });
  });

  describe("processStream", () => {
    it("accumulates text-delta events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "world" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(state.accumulatedText, "Hello world");
      assertEquals(events.length, 2);
      assertEquals(events[0], { type: "text-delta", id: "text-1", delta: "Hello " });
      assertEquals(events[1], { type: "text-delta", id: "text-1", delta: "world" });
    });

    it("calls onChunk callback for each text delta", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      const chunks: string[] = [];

      const result = createMockResult([
        { type: "text-delta", text: "a" },
        { type: "text-delta", text: "b" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", {
        onChunk: (c) => chunks.push(c),
      });

      assertEquals(chunks, ["a", "b"]);
    });

    it("captures finish reason and usage", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      let reportedUsage: Record<string, unknown> | undefined;

      const result = createMockResult([
        { type: "text-delta", text: "hi" },
        {
          type: "finish",
          finishReason: "stop",
          totalUsage: { inputTokens: 10, outputTokens: 5 },
        },
      ]);

      await processStream(result, state, controller, encoder, "t", {
        onUsage: (u) => {
          reportedUsage = u;
        },
      });

      assertEquals(state.finishReason, "stop");
      assertEquals(state.usage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
      assertEquals(reportedUsage, { promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    });

    it("handles finish with null usage", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "finish", finishReason: "length", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.finishReason, "length");
      assertEquals(state.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });

    it("processes tool-input-start and tool-input-delta", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-1", toolName: "search" },
        { type: "tool-input-delta", id: "tc-1", delta: '{"query":' },
        { type: "tool-input-delta", id: "tc-1", delta: '"test"}' },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.size, 1);
      const tc = state.toolCalls.get("tc-1")!;
      assertEquals(tc.name, "search");
      assertEquals(tc.arguments, '{"query":"test"}');

      assertEquals(events[0], { type: "tool-input-start", toolCallId: "tc-1", toolName: "search" });
      assertEquals(events[1], {
        type: "tool-input-delta",
        toolCallId: "tc-1",
        inputTextDelta: '{"query":',
      });
      assertEquals(events[2], {
        type: "tool-input-delta",
        toolCallId: "tc-1",
        inputTextDelta: '"test"}',
      });
    });

    it("handles tool-call with full input object", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-2",
          toolName: "weather",
          input: { city: "Tokyo" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.size, 1);
      const tc = state.toolCalls.get("tc-2")!;
      assertEquals(tc.name, "weather");
      assertEquals(tc.arguments, '{"city":"Tokyo"}');

      assertEquals(events[0], {
        type: "tool-input-available",
        toolCallId: "tc-2",
        toolName: "weather",
        input: { city: "Tokyo" },
      });
    });

    it("handles multiple tool calls in a single stream", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-call", toolCallId: "tc-a", toolName: "search", input: { q: "a" } },
        { type: "tool-call", toolCallId: "tc-b", toolName: "fetch", input: { url: "b" } },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.size, 2);
      assertEquals(state.toolCalls.get("tc-a")!.name, "search");
      assertEquals(state.toolCalls.get("tc-b")!.name, "fetch");
      assertEquals(state.finishReason, "tool-calls");
      assertEquals(events.length, 2);
    });

    it("ignores tool-input-delta for unknown tool call IDs", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-delta", id: "unknown-id", delta: "data" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.size, 0);
      assertEquals(events.length, 0);
    });

    it("forwards stream errors as SSE error events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "error", error: new Error("Provider timeout") },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events.length, 1);
      assertEquals(events[0], { type: "error", error: "Provider timeout" });
    });

    it("forwards non-Error stream errors as string", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "error", error: "raw string error" },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events[0], { type: "error", error: "raw string error" });
    });

    it("ignores unrecognized stream part types", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "source", source: { id: "s1" } },
        { type: "reasoning-delta", delta: "thinking..." },
        { type: "text-delta", text: "ok" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      // Only text-delta should produce an event
      assertEquals(events.length, 1);
      assertEquals(events[0].type, "text-delta");
    });
  });
});
