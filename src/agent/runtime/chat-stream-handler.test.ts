import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockResult, createSSECollector } from "./chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "./chat-stream-handler.ts";

describe("chat-stream-handler", () => {
  describe("createStreamState", () => {
    it("returns a clean initial state", () => {
      const state = createStreamState();
      assertEquals(state.accumulatedText, "");
      assertEquals(state.finishReason, null);
      assertEquals(state.toolCalls.size, 0);
      assertEquals(state.toolResults.length, 0);
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
      assertEquals(events.length, 4);
      assertEquals(events[0], { type: "text-start", id: "text-1" });
      assertEquals(events[1], { type: "text-delta", id: "text-1", delta: "Hello " });
      assertEquals(events[2], { type: "text-delta", id: "text-1", delta: "world" });
      assertEquals(events[3], { type: "text-end", id: "text-1" });
    });

    it("passes through data-tool-call-status events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "data-tool-call-status",
          data: { toolCallId: "tool-1", status: "pending_input" },
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(events[0], {
        type: "data-tool-call-status",
        data: { toolCallId: "tool-1", status: "pending_input" },
      });
    });

    it("closes and reopens text segments when a tool interrupts assistant text", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "text-delta", text: "Before tool." },
        { type: "tool-input-start", id: "tc-form", toolName: "form_input" },
        {
          type: "tool-call",
          toolCallId: "tc-form",
          toolName: "form_input",
          input: { title: "Need more detail" },
        },
        {
          type: "tool-result",
          toolCallId: "tc-form",
          toolName: "form_input",
          output: { submitted: false },
        },
        { type: "text-delta", text: " After tool." },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(events, [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Before tool." },
        { type: "text-end", id: "text-1" },
        { type: "tool-input-start", toolCallId: "tc-form", toolName: "form_input" },
        {
          type: "tool-input-available",
          toolCallId: "tc-form",
          toolName: "form_input",
          input: { title: "Need more detail" },
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-form",
          output: { submitted: false },
        },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: " After tool." },
        { type: "text-end", id: "text-1" },
      ]);
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

    it("replaces a transient empty-object placeholder when real streamed tool JSON begins", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-placeholder", toolName: "load_skill" },
        { type: "tool-input-delta", id: "tc-placeholder", delta: "{}" },
        { type: "tool-input-delta", id: "tc-placeholder", delta: '{"skillId":"' },
        { type: "tool-input-delta", id: "tc-placeholder", delta: 'plan"}' },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-placeholder")!;
      assertEquals(tc.arguments, '{"skillId":"plan"}');

      assertEquals(events[1], {
        type: "tool-input-delta",
        toolCallId: "tc-placeholder",
        inputTextDelta: "{}",
      });
      assertEquals(events[2], {
        type: "tool-input-delta",
        toolCallId: "tc-placeholder",
        inputTextDelta: '{"skillId":"',
      });
      assertEquals(events[3], {
        type: "tool-input-delta",
        toolCallId: "tc-placeholder",
        inputTextDelta: 'plan"}',
      });
    });

    it("dedupes cumulative streamed tool argument buffers instead of corrupting the JSON payload", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-cumulative", toolName: "create_file" },
        {
          type: "tool-input-delta",
          id: "tc-cumulative",
          delta: '{"path":"plans/report.md","content":"# Report',
        },
        {
          type: "tool-input-delta",
          id: "tc-cumulative",
          delta: '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-cumulative")!;
      assertEquals(
        tc.arguments,
        '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
      );

      assertEquals(events[1], {
        type: "tool-input-delta",
        toolCallId: "tc-cumulative",
        inputTextDelta: '{"path":"plans/report.md","content":"# Report',
      });
      assertEquals(events[2], {
        type: "tool-input-delta",
        toolCallId: "tc-cumulative",
        inputTextDelta: '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
      });
    });

    it("dedupes repeated placeholder-style cumulative tool deltas without swallowing parse errors", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-repeat-placeholder", toolName: "create_file" },
        {
          type: "tool-input-delta",
          id: "tc-repeat-placeholder",
          delta: "{}",
        },
        {
          type: "tool-input-delta",
          id: "tc-repeat-placeholder",
          delta: '"path":"plans/report.md","content":"# Report',
        },
        {
          type: "tool-input-delta",
          id: "tc-repeat-placeholder",
          delta: '"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-repeat-placeholder")!;
      assertEquals(
        tc.arguments,
        '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
      );

      assertEquals(events[1], {
        type: "tool-input-delta",
        toolCallId: "tc-repeat-placeholder",
        inputTextDelta: "{}",
      });
      assertEquals(events[2], {
        type: "tool-input-delta",
        toolCallId: "tc-repeat-placeholder",
        inputTextDelta: '"path":"plans/report.md","content":"# Report',
      });
      assertEquals(events[3], {
        type: "tool-input-delta",
        toolCallId: "tc-repeat-placeholder",
        inputTextDelta: '"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
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

    it("normalizes quote-prefixed first tool-input deltas before a fallback empty tool-call payload arrives", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-leading-quote", toolName: "create_file" },
        {
          type: "tool-input-delta",
          id: "tc-leading-quote",
          delta: '"path":"plans/report.md","content":"# Report',
        },
        {
          type: "tool-call",
          toolCallId: "tc-leading-quote",
          toolName: "create_file",
          input: {},
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-leading-quote")!;
      assertEquals(
        tc.arguments,
        '{"path":"plans/report.md","content":"# Report',
      );

      assertEquals(events[1], {
        type: "tool-input-delta",
        toolCallId: "tc-leading-quote",
        inputTextDelta: '"path":"plans/report.md","content":"# Report',
      });
      assertEquals(events[2], {
        type: "tool-input-available",
        toolCallId: "tc-leading-quote",
        toolName: "create_file",
        input: {},
      });
    });

    it("preserves tool-call input when the provider already emits a JSON string", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-quoted",
          toolName: "web_search",
          input: '{"query":"Veryfront","maxUses":1}',
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.size, 1);
      const tc = state.toolCalls.get("tc-quoted")!;
      assertEquals(tc.arguments, '{"query":"Veryfront","maxUses":1}');

      assertEquals(events[0], {
        type: "tool-input-available",
        toolCallId: "tc-quoted",
        toolName: "web_search",
        input: { query: "Veryfront", maxUses: 1 },
      });
    });

    it("keeps streamed tool JSON when the later tool-call payload is only an empty-object placeholder", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-tool-call-placeholder", toolName: "load_skill" },
        { type: "tool-input-delta", id: "tc-tool-call-placeholder", delta: '{"skillId":"plan"}' },
        {
          type: "tool-call",
          toolCallId: "tc-tool-call-placeholder",
          toolName: "load_skill",
          input: {},
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-tool-call-placeholder")!;
      assertEquals(tc.arguments, '{"skillId":"plan"}');
    });
    it("preserves provider-executed tool calls in stream state and SSE output", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-provider",
          toolName: "web_search",
          input: { query: "Veryfront" },
          providerExecuted: true,
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-provider")!;
      assertEquals(tc.providerExecuted, true);
      assertEquals(events[0], {
        type: "tool-input-available",
        toolCallId: "tc-provider",
        toolName: "web_search",
        input: { query: "Veryfront" },
        providerExecuted: true,
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

    it("forwards tool results as tool-output-available SSE events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-result",
          toolCallId: "tc-web",
          toolName: "web_search",
          input: { query: "latest ai news" },
          output: { results: [{ title: "AI" }] },
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolResults, [{
        toolCallId: "tc-web",
        toolName: "web_search",
        output: { results: [{ title: "AI" }] },
      }]);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-web", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "tc-web",
          toolName: "web_search",
          input: { query: "latest ai news" },
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-web",
          output: { results: [{ title: "AI" }] },
        },
      ]);
    });

    it("forwards errored tool results as tool-output-error SSE events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-result",
          toolCallId: "tc-web",
          toolName: "web_search",
          input: { query: "latest ai news" },
          output: { error: "Search failed" },
          isError: true,
        },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolResults, [{
        toolCallId: "tc-web",
        toolName: "web_search",
        error: { error: "Search failed" },
      }]);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-web", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "tc-web",
          toolName: "web_search",
          input: { query: "latest ai news" },
        },
        {
          type: "tool-output-error",
          toolCallId: "tc-web",
          errorText: '{"error":"Search failed"}',
        },
      ]);
    });

    it("forwards tool-error parts as tool-output-error SSE events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-error",
          toolCallId: "tc-provider-error",
          toolName: "web_search",
          input: { query: "Veryfront" },
          error: "Expected object, received string",
          providerExecuted: true,
        },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolResults, [{
        toolCallId: "tc-provider-error",
        toolName: "web_search",
        error: "Expected object, received string",
        providerExecuted: true,
      }]);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-provider-error", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "tc-provider-error",
          toolName: "web_search",
          input: { query: "Veryfront" },
          providerExecuted: true,
        },
        {
          type: "tool-output-error",
          toolCallId: "tc-provider-error",
          errorText: "Expected object, received string",
          providerExecuted: true,
        },
      ]);
    });

    it("uses Error.message for streamed tool-error SSE events", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-error",
          toolCallId: "tc-provider-error-object",
          toolName: "web_search",
          input: { query: "Veryfront" },
          error: new Error("Provider timeout"),
          providerExecuted: true,
        },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-provider-error-object",
          toolName: "web_search",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-provider-error-object",
          toolName: "web_search",
          input: { query: "Veryfront" },
          providerExecuted: true,
        },
        {
          type: "tool-output-error",
          toolCallId: "tc-provider-error-object",
          errorText: "Provider timeout",
          providerExecuted: true,
        },
      ]);
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

    it("forwards reasoning stream parts", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        { type: "reasoning-end", id: "reasoning-1" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        { type: "reasoning-end", id: "reasoning-1" },
      ]);
    });

    it("closes reasoning when tool activity interrupts it and synthesizes missing tool lifecycle before raw tool results", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        {
          type: "tool-result",
          toolCallId: "tc-standalone",
          toolName: "web_search",
          input: { query: "Veryfront" },
          output: { ok: true },
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        { type: "reasoning-end", id: "reasoning-1" },
        { type: "tool-input-start", toolCallId: "tc-standalone", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "tc-standalone",
          toolName: "web_search",
          input: { query: "Veryfront" },
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-standalone",
          output: { ok: true },
        },
      ]);
    });

    it("closes reasoning when the run finishes without an explicit reasoning-end", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [
        { type: "reasoning-start", id: "reasoning-1" },
        { type: "reasoning-delta", id: "reasoning-1", delta: "thinking..." },
        { type: "reasoning-end", id: "reasoning-1" },
      ]);
    });

    it("ignores unrecognized stream part types", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "source", source: { id: "s1" } },
        { type: "text-delta", text: "ok" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "ok" },
        { type: "text-end", id: "t" },
      ]);
    });
  });
});
