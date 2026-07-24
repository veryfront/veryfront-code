import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  SpanKind,
} from "#veryfront/observability/tracing/api-shim.ts";
import { createMockResult, createSSECollector } from "./chat-stream-handler.test-helpers.ts";
import {
  createStreamState,
  processStream,
  processStreamInternal,
  summarizeProviderToolDebugValue,
} from "./chat-stream-handler.ts";
import {
  type createStreamLifecycleShadow,
  type StreamLifecycleShadowReport,
} from "./stream-lifecycle-shadow.ts";

afterEach(() => {
  _resetShimForTests();
});

function emptyAsyncIterable() {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

function pendingAsyncIterable() {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<unknown>> {
          await new Promise(() => {});
          return { done: true, value: undefined };
        },
      };
    },
  };
}

describe("chat-stream-handler", () => {
  describe("summarizeProviderToolDebugValue", () => {
    it("redacts sensitive provider tool debug fields", () => {
      assertEquals(
        summarizeProviderToolDebugValue({
          query: "Swedish tax residency",
          authorization: "Bearer secret-token",
          nested: { apiKey: "sk-secret" },
        }),
        {
          query: "Swedish tax residency",
          authorization: "[REDACTED]",
          nested: { apiKey: "[REDACTED]" },
        },
      );
    });

    it("sanitizes URL credentials in provider tool debug errors", () => {
      const error = new Error("GET https://example.test/path?access_token=secret failed");
      const summary = summarizeProviderToolDebugValue(error) as { message: string; stack: string };

      assertEquals(summary.message.includes("secret"), false);
      assertEquals(summary.message.includes("access_token=[REDACTED]"), true);
      assertEquals(summary.stack.includes("access_token=secret"), false);
    });
  });

  describe("createStreamState", () => {
    it("returns a clean initial state", () => {
      const state = createStreamState();
      assertEquals(state.accumulatedText, "");
      assertEquals(state.reasoningParts, []);
      assertEquals(state.finishReason, null);
      assertEquals(state.toolCalls.size, 0);
      assertEquals(state.toolResults.length, 0);
      assertEquals(state.suppressedToolCalls, []);
      assertEquals(state.usage, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });
  });

  describe("processStream", () => {
    it("starts the model stream trace as a GenAI client span", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      const attributes: Record<string, unknown> = {};
      const spanContext: SpanContext = {
        traceId: "00000000000000000000000000000001",
        spanId: "0000000000000001",
        traceFlags: 1,
      };
      let capturedName: string | undefined;
      let capturedKind: number | undefined;
      let capturedAttributes: Record<string, unknown> | undefined;
      const span: Span = {
        setAttribute(key, value) {
          attributes[key] = value;
          return span;
        },
        setAttributes(values) {
          Object.assign(attributes, values);
          return span;
        },
        setStatus() {
          return span;
        },
        recordException() {},
        addEvent() {
          return span;
        },
        end() {},
        spanContext() {
          return spanContext;
        },
        updateName() {},
      };

      setGlobalTracerProvider({
        getTracer() {
          return {
            startSpan(name, options) {
              capturedName = name;
              capturedKind = options?.kind;
              capturedAttributes = options?.attributes;
              Object.assign(attributes, options?.attributes);
              return span;
            },
            startActiveSpan<T>(
              _name: string,
              optionsOrFn:
                | { kind?: number; attributes?: Record<string, AttributeValue> }
                | ((span: Span) => T),
              contextOrFn?: unknown,
              fn?: (span: Span) => T,
            ): T {
              const callback = typeof optionsOrFn === "function"
                ? optionsOrFn
                : typeof contextOrFn === "function"
                ? contextOrFn as (span: Span) => T
                : fn!;
              return callback(span);
            },
          };
        },
      });

      await processStream(
        createMockResult([
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          },
        ]),
        state,
        controller,
        encoder,
        "text-1",
        {
          traceSpanName: "chat openai/gpt-5.4",
          traceAttributes: {
            "gen_ai.provider.name": "openai",
            "gen_ai.request.model": "openai/gpt-5.4",
            "gen_ai.response.model": "openai/gpt-5.4",
          },
        },
      );

      assertEquals(capturedName, "chat openai/gpt-5.4");
      assertEquals(capturedKind, SpanKind.CLIENT);
      assertEquals(capturedAttributes?.["gen_ai.operation.name"], "chat");
      assertEquals(capturedAttributes?.["gen_ai.request.stream"], true);
      assertEquals(attributes["gen_ai.response.finish_reasons"], ["stop"]);
      assertEquals(attributes["gen_ai.usage.input_tokens"], 2);
      assertEquals(attributes["gen_ai.usage.output_tokens"], 3);
      assertEquals(attributes["gen_ai.usage.total_tokens"], 5);
    });

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

    it("renders MCP tool_error outputs as visible tool output errors", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-create-agent",
          toolName: "create_agent",
          input: {
            project_reference: "outlook-agent-zxywv0",
            id: "harvest-timesheet-agent",
          },
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "tc-create-agent",
          toolName: "create_agent",
          output: {
            error: "tool_error",
            message: "Unknown tool references: harvest__list_accounts",
          },
          providerExecuted: true,
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(state.toolResults, [
        {
          toolCallId: "tc-create-agent",
          toolName: "create_agent",
          error: "Unknown tool references: harvest__list_accounts",
          providerExecuted: true,
        },
      ]);
      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-create-agent",
          toolName: "create_agent",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-create-agent",
          toolName: "create_agent",
          input: {
            project_reference: "outlook-agent-zxywv0",
            id: "harvest-timesheet-agent",
          },
          providerExecuted: true,
        },
        {
          type: "tool-output-error",
          toolCallId: "tc-create-agent",
          errorText: "Unknown tool references: harvest__list_accounts",
          providerExecuted: true,
        },
      ]);
    });

    it("preserves integration reconnect actions as structured tool output", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const reconnectRequired = {
        error: "reconnect_required",
        integration: "gmail",
        connectUrl: "https://api.example.test/oauth/connect/gmail?projectId=project-1",
        message: "Reconnect Gmail to continue.",
      };
      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-gmail-auth",
          toolName: "gmail__list_emails",
          input: {},
        },
        {
          type: "tool-result",
          toolCallId: "tc-gmail-auth",
          toolName: "gmail__list_emails",
          output: reconnectRequired,
          isError: true,
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(state.toolResults, [
        {
          toolCallId: "tc-gmail-auth",
          toolName: "gmail__list_emails",
          output: reconnectRequired,
        },
      ]);
      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-gmail-auth",
          toolName: "gmail__list_emails",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-gmail-auth",
          toolName: "gmail__list_emails",
          input: {},
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-gmail-auth",
          output: reconnectRequired,
        },
      ]);
    });

    it("accumulates streamed reasoning text with Anthropic signatures", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "reasoning-start", id: "thinking-0" },
        { type: "reasoning-delta", id: "thinking-0", delta: "Check evidence." },
        { type: "reasoning-end", id: "thinking-0", signature: "sig_123" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", undefined);

      assertEquals(state.reasoningParts, [{
        id: "thinking-0",
        text: "Check evidence.",
        signature: "sig_123",
      }]);
      assertEquals(events, [
        { type: "reasoning-start", id: "thinking-0" },
        { type: "reasoning-delta", id: "thinking-0", delta: "Check evidence." },
        { type: "reasoning-end", id: "thinking-0", signature: "sig_123" },
      ]);
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
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "tc-form",
          toolName: "form_input",
          output: { submitted: false },
          providerExecuted: true,
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
          providerExecuted: true,
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-form",
          output: { submitted: false },
          providerExecuted: true,
        },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: " After tool." },
        { type: "text-end", id: "text-1" },
      ]);
    });

    it("suppresses streamed tool calls that are not available in the current step", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "text-delta", text: "I will reload the skill." },
        { type: "tool-input-start", id: "tc-stale", toolName: "load_skill" },
        { type: "tool-input-delta", id: "tc-stale", delta: '{"id":"create-agent"}' },
        { type: "tool-input-end", id: "tc-stale" },
        {
          type: "tool-call",
          toolCallId: "tc-stale",
          toolName: "load_skill",
          input: { id: "create-agent" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "text-1", {
        availableToolNames: ["create_agent", "list_integrations", "get_integration"],
      });

      assertEquals(state.toolCalls.size, 0);
      assertEquals(state.toolResults, []);
      assertEquals(state.suppressedToolCalls, [{ id: "tc-stale", name: "load_skill" }]);
      assertEquals(events, [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "I will reload the skill." },
        { type: "text-end", id: "text-1" },
      ]);
    });

    it("stops reading after a committed local tool-call so the runtime can execute it", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      let returned = false;
      let index = 0;
      let resolvePendingNext: ((value: IteratorResult<unknown>) => void) | undefined;
      const parts = [
        { type: "tool-input-start", id: "tc-local", toolName: "number-generator" },
        { type: "tool-input-delta", id: "tc-local", delta: '{"min":3' },
        { type: "tool-input-delta", id: "tc-local", delta: ',"max":9}' },
        {
          type: "tool-call",
          toolCallId: "tc-local",
          toolName: "number-generator",
          input: { min: 3, max: 9 },
        },
      ];

      const result = {
        fullStream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (index < parts.length) {
                  return { done: false, value: parts[index++] };
                }
                return await new Promise<IteratorResult<unknown>>((resolve) => {
                  resolvePendingNext = resolve;
                });
              },
              async return() {
                resolvePendingNext?.({ done: true, value: undefined });
                resolvePendingNext = undefined;
                returned = true;
                return { done: true, value: undefined };
              },
            };
          },
        },
        textStream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: true as const, value: undefined };
              },
            };
          },
        },
      };

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(returned, true);
      assertEquals(state.finishReason, "tool-calls");
      const toolCall = state.toolCalls.get("tc-local");
      assertEquals(toolCall?.id, "tc-local");
      assertEquals(toolCall?.name, "number-generator");
      assertEquals(toolCall?.arguments, '{"min":3,"max":9}');
      assertEquals(toolCall?.inputAvailable, true);
      assertEquals(toolCall?.providerExecuted, undefined);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-local", toolName: "number-generator" },
        { type: "tool-input-delta", toolCallId: "tc-local", inputTextDelta: '{"min":3' },
        { type: "tool-input-delta", toolCallId: "tc-local", inputTextDelta: ',"max":9}' },
        {
          type: "tool-input-available",
          toolCallId: "tc-local",
          toolName: "number-generator",
          input: { min: 3, max: 9 },
        },
      ]);
    });

    it("finalizes streamed local tool input when the provider emits tool-input-end without a tool-call part", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-local-end", toolName: "retrieveDocumentEvidence" },
        { type: "tool-input-delta", id: "tc-local-end", delta: "{}" },
        { type: "tool-input-end", id: "tc-local-end" },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const toolCall = state.toolCalls.get("tc-local-end");
      assertEquals(toolCall?.id, "tc-local-end");
      assertEquals(toolCall?.name, "retrieveDocumentEvidence");
      assertEquals(toolCall?.arguments, "{}");
      assertEquals(toolCall?.inputAvailable, true);
      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-local-end",
          toolName: "retrieveDocumentEvidence",
        },
        {
          type: "tool-input-delta",
          toolCallId: "tc-local-end",
          inputTextDelta: "{}",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-local-end",
          toolName: "retrieveDocumentEvidence",
          input: {},
        },
      ]);
    });

    it("finalizes parseable streamed local tool input when the provider finishes without a final tool-call part", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-finish", toolName: "retrieveDocumentEvidence" },
        { type: "tool-input-delta", id: "tc-finish", delta: '{"uploadId":"upload-1"}' },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const toolCall = state.toolCalls.get("tc-finish");
      assertEquals(toolCall?.inputAvailable, true);
      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-finish",
          toolName: "retrieveDocumentEvidence",
        },
        {
          type: "tool-input-delta",
          toolCallId: "tc-finish",
          inputTextDelta: '{"uploadId":"upload-1"}',
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-finish",
          toolName: "retrieveDocumentEvidence",
          input: { uploadId: "upload-1" },
        },
      ]);
    });

    it("does not emit duplicate input-available when tool-input-end is followed by tool-call", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "tool-input-start", id: "tc-end-plus-call", toolName: "lookup" },
        { type: "tool-input-delta", id: "tc-end-plus-call", delta: '{"query":"DORA"}' },
        { type: "tool-input-end", id: "tc-end-plus-call" },
        {
          type: "tool-call",
          toolCallId: "tc-end-plus-call",
          toolName: "lookup",
          input: { query: "DORA" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(
        events.filter((event) => event.type === "tool-input-available"),
        [
          {
            type: "tool-input-available",
            toolCallId: "tc-end-plus-call",
            toolName: "lookup",
            input: { query: "DORA" },
          },
        ],
      );
      assertEquals(state.toolCalls.get("tc-end-plus-call")?.arguments, '{"query":"DORA"}');
    });

    it("treats provider tool-input-available as the committed local tool call", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-input-start",
          id: "tc-provider-available",
          toolName: "retrieveDocumentEvidence",
        },
        { type: "tool-input-delta", id: "tc-provider-available", delta: "{}" },
        {
          type: "tool-input-available",
          toolCallId: "tc-provider-available",
          toolName: "retrieveDocumentEvidence",
          input: { uploadId: "upload-1" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const toolCall = state.toolCalls.get("tc-provider-available");
      assertEquals(toolCall?.inputAvailable, true);
      assertEquals(toolCall?.arguments, '{"uploadId":"upload-1"}');
      assertEquals(
        events.filter((event) => event.type === "tool-input-available"),
        [
          {
            type: "tool-input-available",
            toolCallId: "tc-provider-available",
            toolName: "retrieveDocumentEvidence",
            input: { uploadId: "upload-1" },
          },
        ],
      );
    });

    it("does not wait for provider stream cancellation after a committed local tool-call", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      let returnCalled = false;
      let index = 0;
      const parts = [
        { type: "tool-input-start", id: "tc-local", toolName: "number-generator" },
        { type: "tool-input-delta", id: "tc-local", delta: '{"min":3,"max":9}' },
        {
          type: "tool-call",
          toolCallId: "tc-local",
          toolName: "number-generator",
          input: { min: 3, max: 9 },
        },
      ];

      const result = {
        fullStream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                if (index < parts.length) {
                  return { done: false, value: parts[index++] };
                }
                return await new Promise<IteratorResult<unknown>>(() => {});
              },
              async return() {
                returnCalled = true;
                return await new Promise<IteratorResult<unknown>>(() => {});
              },
            };
          },
        },
        textStream: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                return { done: true as const, value: undefined };
              },
            };
          },
        },
      };

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(returnCalled, true);
      assertEquals(state.finishReason, "tool-calls");
      assertEquals(state.toolCalls.get("tc-local")?.inputAvailable, true);
    });

    it("allows a second local tool input to finish after a prior local tool was committed", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "tool-input-start", id: "tc-a", toolName: "load_skill" };
            yield { type: "tool-input-delta", id: "tc-a", delta: '{"skillId":"dora"}' };
            yield { type: "tool-input-end", id: "tc-a" };
            yield {
              type: "tool-input-start",
              id: "tc-b",
              toolName: "load_skill_reference",
            };
            await new Promise((resolve) => setTimeout(resolve, 300));
            yield {
              type: "tool-input-delta",
              id: "tc-b",
              delta: '{"skillId":"dora","reference":"references/article-17.md"}',
            };
            yield { type: "tool-input-end", id: "tc-b" };
            yield { type: "finish", finishReason: "tool-calls", totalUsage: null };
          },
        },
        textStream: emptyAsyncIterable(),
      };

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.get("tc-a")?.inputAvailable, true);
      assertEquals(state.toolCalls.get("tc-b")?.inputAvailable, true);
      assertEquals(
        events.filter((event) => event.type === "tool-input-available"),
        [
          {
            type: "tool-input-available",
            toolCallId: "tc-a",
            toolName: "load_skill",
            input: { skillId: "dora" },
          },
          {
            type: "tool-input-available",
            toolCallId: "tc-b",
            toolName: "load_skill_reference",
            input: { skillId: "dora", reference: "references/article-17.md" },
          },
        ],
      );
    });

    it("does not cut off a slow active local tool input before the provider finishes it", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "tool-input-start",
              id: "tc-slow",
              toolName: "retrieveDocumentEvidence",
            };
            yield {
              type: "tool-input-delta",
              id: "tc-slow",
              delta: '{"uploadId":"upload-1",',
            };
            await new Promise((resolve) => setTimeout(resolve, 2_100));
            yield {
              type: "tool-input-delta",
              id: "tc-slow",
              delta: '"name":"sample-ict-services-agreement.docx"}',
            };
            yield { type: "tool-input-end", id: "tc-slow" };
            yield { type: "finish", finishReason: "tool-calls", totalUsage: null };
          },
        },
        textStream: emptyAsyncIterable(),
      };

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolCalls.get("tc-slow")?.inputAvailable, true);
      assertEquals(
        events.filter((event) => event.type === "tool-input-available"),
        [
          {
            type: "tool-input-available",
            toolCallId: "tc-slow",
            toolName: "retrieveDocumentEvidence",
            input: {
              uploadId: "upload-1",
              name: "sample-ict-services-agreement.docx",
            },
          },
        ],
      );
    });

    it("times out an active local tool input instead of hanging the stream forever", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "tool-input-start", id: "tc-a", toolName: "load_skill" };
            yield { type: "tool-input-delta", id: "tc-a", delta: '{"skillId":"dora"}' };
            yield { type: "tool-input-end", id: "tc-a" };
            yield {
              type: "tool-input-start",
              id: "tc-b",
              toolName: "load_skill_reference",
            };
            await new Promise(() => {});
          },
        },
        textStream: emptyAsyncIterable(),
      };

      const startedAt = Date.now();
      await processStream(result, state, controller, encoder, "t", {
        localToolInputIdleTimeoutMs: 10,
      });

      assertEquals(state.finishReason, "tool-calls");
      assertEquals(state.toolCalls.get("tc-a")?.inputAvailable, true);
      assertEquals(state.toolCalls.get("tc-b")?.inputAvailable, false);
      assertEquals(Date.now() - startedAt >= 9, true);
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

    it("times out an idle stream before any output starts", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: pendingAsyncIterable(),
        textStream: emptyAsyncIterable(),
      };

      await processStream(result, state, controller, encoder, "t", {
        streamIdleTimeoutMs: 10,
      });

      assertEquals(state.finishReason, "stop");
      assertEquals(events, []);
    });

    it("times out an idle output stream after assistant output starts", async () => {
      const { controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "text-delta", text: "Ready." };
            await new Promise(() => {});
          },
        },
        textStream: emptyAsyncIterable(),
      };

      await processStream(result, state, controller, encoder, "t", {
        streamIdleTimeoutMs: 10,
      });

      assertEquals(state.accumulatedText, "Ready.");
      assertEquals(state.finishReason, "stop");
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

    it("ignores a late provider body read error after a completed tool-call step", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const result = {
        fullStream: {
          async *[Symbol.asyncIterator]() {
            yield { type: "tool-input-start", id: "tc-1", toolName: "gmail__get_email" };
            yield { type: "tool-input-delta", id: "tc-1", delta: '{"id":"msg-1"}' };
            yield { type: "finish", finishReason: "tool-calls", totalUsage: null };
            throw new Error("error reading a body from connection");
          },
        },
        textStream: emptyAsyncIterable(),
      };

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.finishReason, "tool-calls");
      assertEquals(state.toolCalls.size, 1);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-1", toolName: "gmail__get_email" },
        {
          type: "tool-input-delta",
          toolCallId: "tc-1",
          inputTextDelta: '{"id":"msg-1"}',
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-1",
          toolName: "gmail__get_email",
          input: { id: "msg-1" },
        },
      ]);
    });

    it("commits buffered tool-input-start and tool-input-delta when the tool call finishes", async () => {
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
      assertEquals(tc.inputAvailable, true);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-1", toolName: "search" },
        { type: "tool-input-delta", toolCallId: "tc-1", inputTextDelta: '{"query":' },
        { type: "tool-input-delta", toolCallId: "tc-1", inputTextDelta: '"test"}' },
        {
          type: "tool-input-available",
          toolCallId: "tc-1",
          toolName: "search",
          input: { query: "test" },
        },
      ]);
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
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-placeholder", toolName: "load_skill" },
        { type: "tool-input-delta", toolCallId: "tc-placeholder", inputTextDelta: "{}" },
        { type: "tool-input-delta", toolCallId: "tc-placeholder", inputTextDelta: '{"skillId":"' },
        { type: "tool-input-delta", toolCallId: "tc-placeholder", inputTextDelta: 'plan"}' },
        {
          type: "tool-input-available",
          toolCallId: "tc-placeholder",
          toolName: "load_skill",
          input: { skillId: "plan" },
        },
      ]);
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
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-cumulative", toolName: "create_file" },
        {
          type: "tool-input-delta",
          toolCallId: "tc-cumulative",
          inputTextDelta: '{"path":"plans/report.md","content":"# Report',
        },
        {
          type: "tool-input-delta",
          toolCallId: "tc-cumulative",
          inputTextDelta: '{"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-cumulative",
          toolName: "create_file",
          input: {
            path: "plans/report.md",
            content: "# Report\n\nExecutive summary",
          },
        },
      ]);
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
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-repeat-placeholder", toolName: "create_file" },
        { type: "tool-input-delta", toolCallId: "tc-repeat-placeholder", inputTextDelta: "{}" },
        {
          type: "tool-input-delta",
          toolCallId: "tc-repeat-placeholder",
          inputTextDelta: '"path":"plans/report.md","content":"# Report',
        },
        {
          type: "tool-input-delta",
          toolCallId: "tc-repeat-placeholder",
          inputTextDelta: '"path":"plans/report.md","content":"# Report\\n\\nExecutive summary"}',
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-repeat-placeholder",
          toolName: "create_file",
          input: {
            path: "plans/report.md",
            content: "# Report\n\nExecutive summary",
          },
        },
      ]);
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

      assertEquals(events, [{
        type: "tool-input-start",
        toolCallId: "tc-2",
        toolName: "weather",
      }, {
        type: "tool-input-available",
        toolCallId: "tc-2",
        toolName: "weather",
        input: { city: "Tokyo" },
      }]);
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

      assertEquals(events, [{
        type: "tool-input-start",
        toolCallId: "tc-quoted",
        toolName: "web_search",
      }, {
        type: "tool-input-available",
        toolCallId: "tc-quoted",
        toolName: "web_search",
        input: { query: "Veryfront", maxUses: 1 },
      }]);
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
      assertEquals(events, [{
        type: "tool-input-start",
        toolCallId: "tc-provider",
        toolName: "web_search",
      }, {
        type: "tool-input-available",
        toolCallId: "tc-provider",
        toolName: "web_search",
        input: { query: "Veryfront" },
        providerExecuted: true,
      }]);
    });

    it("marks configured provider-native tool calls as provider-executed when the provider omits the flag", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-provider-inferred",
          toolName: "web_search",
          input: { query: "Veryfront" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", {
        providerExecutedToolNames: ["web_search"],
      });

      const tc = state.toolCalls.get("tc-provider-inferred")!;
      assertEquals(tc.providerExecuted, true);
      assertEquals(events, [{
        type: "tool-input-start",
        toolCallId: "tc-provider-inferred",
        toolName: "web_search",
      }, {
        type: "tool-input-available",
        toolCallId: "tc-provider-inferred",
        toolName: "web_search",
        input: { query: "Veryfront" },
        providerExecuted: true,
      }]);
    });

    it("does not infer provider execution for same-name local tools without provider metadata", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "tc-local-web-search",
          toolName: "web_search",
          input: { query: "Veryfront" },
        },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      const tc = state.toolCalls.get("tc-local-web-search")!;
      assertEquals(tc.providerExecuted, undefined);
      assertEquals(events, [{
        type: "tool-input-start",
        toolCallId: "tc-local-web-search",
        toolName: "web_search",
      }, {
        type: "tool-input-available",
        toolCallId: "tc-local-web-search",
        toolName: "web_search",
        input: { query: "Veryfront" },
      }]);
    });

    it("marks configured provider-native tool results as provider-executed when the provider omits the flag", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        {
          type: "tool-result",
          toolCallId: "tc-provider-result-inferred",
          toolName: "web_search",
          input: { query: "Veryfront" },
          output: { results: [{ title: "Veryfront" }] },
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", {
        providerExecutedToolNames: ["web_search"],
      });

      assertEquals(state.toolResults, [{
        toolCallId: "tc-provider-result-inferred",
        toolName: "web_search",
        output: { results: [{ title: "Veryfront" }] },
        providerExecuted: true,
      }]);
      assertEquals(events, [
        {
          type: "tool-input-start",
          toolCallId: "tc-provider-result-inferred",
          toolName: "web_search",
        },
        {
          type: "tool-input-available",
          toolCallId: "tc-provider-result-inferred",
          toolName: "web_search",
          input: { query: "Veryfront" },
          providerExecuted: true,
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-provider-result-inferred",
          output: { results: [{ title: "Veryfront" }] },
          providerExecuted: true,
        },
      ]);
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
      assertEquals(events.length, 4);
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

    it("accepts provider-native tool-result.result payloads as tool output", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const providerResult = {
        type: "web_search_result",
        results: [{ title: "Pasta", url: "https://example.test/pasta" }],
      };
      const result = createMockResult([
        {
          type: "tool-result",
          toolCallId: "tc-provider-search",
          toolName: "web_search",
          input: { query: "pasta" },
          result: providerResult,
          providerExecuted: true,
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(state.toolResults, [{
        toolCallId: "tc-provider-search",
        toolName: "web_search",
        output: providerResult,
        providerExecuted: true,
      }]);
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "tc-provider-search", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "tc-provider-search",
          toolName: "web_search",
          input: { query: "pasta" },
          providerExecuted: true,
        },
        {
          type: "tool-output-available",
          toolCallId: "tc-provider-search",
          output: providerResult,
          providerExecuted: true,
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

describe("stream lifecycle shadow mode", () => {
  type FixtureProcess = typeof processStream;

  async function runTextFixture(input: {
    mode: "legacy" | "shadow";
    process?: FixtureProcess;
  }) {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();
    let report: StreamLifecycleShadowReport | undefined;
    await (input.process ?? processStream)(
      createMockResult([
        { type: "text-delta", text: "hello" },
        { type: "finish", finishReason: "stop" },
      ]),
      state,
      controller,
      encoder,
      "text-1",
      {
        streamLifecycleMode: input.mode,
        onLifecycleShadowReport: (next) => report = next,
      },
      undefined,
    );
    return { events, state, report };
  }

  it("keeps SSE and state identical when the shadow observer throws", async () => {
    const throwingShadowFactory: typeof createStreamLifecycleShadow = () => ({
      observePart() {
        throw new Error("shadow-only failure");
      },
      compareLegacySnapshot() {
        return { count: 1, categories: ["shadow_error"] };
      },
    });

    const legacy = await runTextFixture({ mode: "legacy" });
    const shadow = await runTextFixture({
      mode: "shadow",
      process: (
        result,
        state,
        controller,
        encoder,
        textPartId,
        callbacks,
        abortSignal,
      ) =>
        processStreamInternal(
          result,
          state,
          controller,
          encoder,
          textPartId,
          callbacks,
          abortSignal,
          { createShadow: throwingShadowFactory },
        ),
    });

    assertEquals(shadow.events, legacy.events);
    assertEquals(shadow.state, legacy.state);
    assertEquals(shadow.report, { count: 1, categories: ["shadow_error"] });
  });

  it("reports zero divergences for a matching text stream", async () => {
    const shadow = await runTextFixture({ mode: "shadow" });
    assertEquals(shadow.report, { count: 0, categories: [] });
  });

  it("does not build a shadow or report in legacy mode", async () => {
    const legacy = await runTextFixture({ mode: "legacy" });
    assertEquals(legacy.report, undefined);
  });
});
