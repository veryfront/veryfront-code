import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
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
  createRuntimeStreamSource,
  createStreamState,
  processStream,
  processStreamInternal,
  resolveRuntimeStreamErrorEvent,
  summarizeProviderToolDebugValue,
} from "./chat-stream-handler.ts";
import {
  type createStreamLifecycleShadow,
  type StreamLifecycleShadowReport,
} from "./stream-lifecycle-shadow.ts";
import {
  ManualMonotonicClock,
  StreamLifecycleFailure,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import { shouldContinueAfterStreamStep } from "./tool-result-continuation.ts";
import { createChatUiMessageStreamFromDataStream } from "#veryfront/agent/streaming/chat-ui-message-stream.ts";
import {
  hasIncompleteToolParts,
  isToolUiPart,
  toConversationPartsFromUiMessage,
} from "#veryfront/chat/conversation.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import { ProviderOverloadedError, ProviderQuotaError } from "#veryfront/provider/runtime-loader.ts";

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
        { type: "text-delta", text: "I've opened the panel." },
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
        { type: "text-start", id: "text-1:1" },
        { type: "text-delta", id: "text-1:1", delta: "I've opened the panel." },
        { type: "text-end", id: "text-1:1" },
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
      let releasePause: () => void = () => {};
      const paused = new Promise<void>((resolve) => {
        releasePause = resolve;
      });
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
            await paused;
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

      const processing = processStream(result, state, controller, encoder, "t", {
        localToolInputIdleTimeoutMs: 1_000,
      });
      // Let the handler park on the pending delta before the provider resumes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      releasePause();
      await processing;

      assertEquals(
        state.toolCalls.get("tc-slow")?.inputAvailable,
        true,
        "a paused local tool input that resumes within the idle timeout must complete",
      );
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
        "the resumed deltas must merge into a single tool-input-available event",
      );
    });

    it("cuts off a local tool input that idles past the configured timeout", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      let nextTimerId = -1;
      const clearedTimeouts: number[] = [];
      const pendingTimers = new Map<number, {
        callback: () => void;
        timeoutMs: number;
      }>();
      let markPendingReadStarted: () => void = () => {};
      const pendingReadStarted = new Promise<void>((resolve) => {
        markPendingReadStarted = resolve;
      });
      let releasePendingRead: () => void = () => {};
      const pendingRead = new Promise<IteratorResult<unknown>>((resolve) => {
        releasePendingRead = () => resolve({ done: true, value: undefined });
      });
      const parts = [
        {
          type: "tool-input-start",
          id: "tc-slow",
          toolName: "retrieveDocumentEvidence",
        },
        {
          type: "tool-input-delta",
          id: "tc-slow",
          delta: '{"uploadId":"upload-1",',
        },
      ];
      let nextPartIndex = 0;
      const result = {
        fullStream: {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<unknown>> {
                const part = parts[nextPartIndex++];
                if (part !== undefined) {
                  return Promise.resolve({ done: false, value: part });
                }
                markPendingReadStarted();
                return pendingRead;
              },
              return(): Promise<IteratorResult<unknown>> {
                return Promise.resolve({ done: true, value: undefined });
              },
            };
          },
        },
        textStream: emptyAsyncIterable(),
      };

      const processing = processStream(result, state, controller, encoder, "t", {
        localToolInputIdleTimeoutMs: 10,
        setTimeoutFn: ((callback: () => void, timeoutMs?: number) => {
          const id = ++nextTimerId;
          pendingTimers.set(id, { callback, timeoutMs: timeoutMs ?? 0 });
          return id;
        }) as typeof setTimeout,
        clearTimeoutFn: ((id: number) => {
          clearedTimeouts.push(id);
          pendingTimers.delete(id);
        }) as typeof clearTimeout,
      });

      let deadlineId = -1;
      try {
        await pendingReadStarted;
        const pendingDeadlines = [...pendingTimers.entries()];
        assertEquals(
          pendingDeadlines.length,
          1,
          "only the deadline around the pending iterator read may remain active",
        );
        const pendingDeadline = pendingDeadlines[0];
        if (pendingDeadline === undefined) {
          throw new Error("the pending iterator read did not schedule a deadline");
        }
        const [id, deadline] = pendingDeadline;
        deadlineId = id;
        assertEquals(
          deadline.timeoutMs,
          10,
          "the pending local tool input must schedule the configured 10ms idle deadline",
        );
        deadline.callback();
        await processing;
      } finally {
        for (const deadline of pendingTimers.values()) deadline.callback();
        releasePendingRead();
        await processing.catch(() => {});
      }
      assertEquals(
        clearedTimeouts.filter((id) => id === 0).length,
        1,
        "the initial stream deadline must clear the valid zero timer handle",
      );
      assertEquals(
        clearedTimeouts.filter((id) => id === deadlineId).length,
        1,
        "the settled idle deadline must be cleared exactly once",
      );

      assertEquals(
        state.toolCalls.get("tc-slow")?.inputAvailable,
        false,
        "a local tool input that idles past the configured timeout must not be marked available",
      );
      assertEquals(
        events.filter((event) => event.type === "tool-input-available"),
        [],
        "a cut-off local tool input must not emit tool-input-available",
      );
      assertEquals(
        state.finishReason,
        "tool-calls",
        "a cut-off local tool input still ends the step",
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
      }, {
        type: "tool-output-error",
        toolCallId: "tc-provider",
        errorText:
          'Provider-executed tool "web_search" returned no result before the model turn ended.',
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
      }, {
        type: "tool-output-error",
        toolCallId: "tc-provider-inferred",
        errorText:
          'Provider-executed tool "web_search" returned no result before the model turn ended.',
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

    it("contains hostile Proxy errors as one in-band fallback event", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const hostileError = new Proxy(new Error("original fallback"), {
        getPrototypeOf() {
          throw new Error("hostile getPrototypeOf");
        },
      });
      const result = createMockResult([
        { type: "error", error: hostileError },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [{ type: "error", error: "Unknown error" }]);
    });

    it("preserves curated terminal details from structured stream error parts", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();
      const providerError = new Error("Provider request failed with status 402");
      Object.defineProperty(providerError, "responseBody", {
        value: JSON.stringify({
          slug: "insufficient-credits",
          suggestion: "Purchase additional credits or select a lower-cost model.",
          privateDetail: "provider-private-diagnostic",
        }),
      });

      const result = createMockResult([
        { type: "error", error: providerError },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events, [{
        type: "error",
        error:
          "Insufficient AI credits. Purchase additional credits or upgrade your subscription plan.",
        code: "INSUFFICIENT_CREDITS",
      }]);
      assertEquals(JSON.stringify(events).includes("provider-private-diagnostic"), false);
    });

    it("preserves provider account and spend-limit classifications at the runtime boundary", () => {
      const cases = [
        {
          body: {
            slug: "insufficient-credits",
            error: "AI provider spend limit exceeded for the daily window.",
            suggestion: "provider-private-suggestion",
          },
          expected: {
            type: "error",
            code: "AI_PROVIDER_SPEND_LIMIT_EXCEEDED",
            error:
              "The AI provider spend limit has been reached. Try again later or ask an administrator to raise the AI provider spend limit.",
          },
        },
        {
          body: {
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
            },
            privateDetail: "provider-private-diagnostic",
          },
          expected: {
            type: "error",
            code: "AI_PROVIDER_BILLING_ERROR",
            error:
              "The configured AI provider account cannot process this request. Try a different model, or ask an administrator to check provider billing.",
          },
        },
      ] as const;

      for (const testCase of cases) {
        const providerError = new Error("Provider request failed");
        Object.defineProperty(providerError, "responseBody", {
          value: JSON.stringify(testCase.body),
        });

        const event = resolveRuntimeStreamErrorEvent(providerError);

        assertEquals(event, testCase.expected);
        assertEquals(JSON.stringify(event).includes("provider-private"), false);
      }
    });

    it("preserves typed provider quota failures before applying 429 heuristics", () => {
      const event = resolveRuntimeStreamErrorEvent(
        new ProviderQuotaError({
          provider: "openai",
          status: 429,
          message: "Provider request failed with status 429",
          retryable: false,
        }),
      );

      assertEquals(event, {
        type: "error",
        code: "AI_PROVIDER_BILLING_ERROR",
        error:
          "The configured AI provider account cannot process this request. Try a different model, or ask an administrator to check provider billing.",
      });
    });

    it("preserves typed provider overload failures before applying message heuristics", () => {
      const event = resolveRuntimeStreamErrorEvent(
        new ProviderOverloadedError({
          provider: "anthropic",
          status: 529,
          message: "Provider request failed with status 529",
          retryable: true,
        }),
      );

      assertEquals(event, {
        type: "error",
        code: "OVERLOADED_ERROR",
        error: "The LLM provider is currently overloaded",
      });
    });

    it("falls back to the original stream error when provider inspection throws", () => {
      const providerError = new Error("Provider stream failed");
      Object.defineProperty(providerError, "responseBody", {
        get() {
          throw new Error("hostile provider accessor");
        },
      });

      assertEquals(resolveRuntimeStreamErrorEvent(providerError), {
        type: "error",
        error: "Provider stream failed",
      });
    });

    it("keeps structured provider diagnostics out of public runtime errors", () => {
      const cases = [
        {
          type: "overloaded_error",
          expected: {
            type: "error",
            code: "OVERLOADED_ERROR",
            error: "The LLM provider is currently overloaded",
          },
        },
        {
          type: "rate_limit_error",
          expected: {
            type: "error",
            code: "RATE_LIMITED",
            error: "Too many requests. Please wait a moment and try again.",
          },
        },
        {
          type: "api_error",
          expected: {
            type: "error",
            error: "Provider request failed",
          },
        },
      ] as const;

      for (const testCase of cases) {
        const providerError = new Error("Provider request failed");
        Object.defineProperty(providerError, "responseBody", {
          value: JSON.stringify({
            type: testCase.type,
            message: `private ${testCase.type} diagnostic`,
          }),
        });

        const event = resolveRuntimeStreamErrorEvent(providerError);
        assertEquals(event, testCase.expected);
        assertEquals(JSON.stringify(event).includes("private"), false);
      }
    });

    it("keeps the unknown active lifecycle fallback code-free", () => {
      const event = resolveRuntimeStreamErrorEvent(
        new StreamLifecycleFailure({
          code: "PROVIDER_STREAM_ERROR",
          providerCode: "PROVIDER_STREAM_ERROR",
          phase: "streaming",
          source: "provider",
          retryable: true,
          publicMessage: "Provider stream failed",
        }),
      );

      assertEquals(event, {
        type: "error",
        error: "Provider stream failed",
      });
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

    it("preserves the existing string fallback for unknown object errors", async () => {
      const { events, controller, encoder } = createSSECollector();
      const state = createStreamState();

      const result = createMockResult([
        { type: "error", error: { message: "object error" } },
        { type: "finish", finishReason: "error", totalUsage: null },
      ]);

      await processStream(result, state, controller, encoder, "t", undefined);

      assertEquals(events[0], { type: "error", error: "[object Object]" });
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

  it("keeps omitted available tool names unrestricted in shadow mode", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();
    let report: StreamLifecycleShadowReport | undefined;

    await processStream(
      createMockResult([
        { type: "tool-input-start", id: "local-1", toolName: "project_tool" },
        { type: "tool-input-delta", id: "local-1", delta: '{"path":"a.md"}' },
        { type: "tool-input-end", id: "local-1" },
        { type: "finish", finishReason: "tool-calls", totalUsage: null },
      ]),
      state,
      controller,
      encoder,
      "text-1",
      {
        streamLifecycleMode: "shadow",
        onLifecycleShadowReport: (next) => report = next,
      },
      undefined,
    );

    assertEquals(report, { count: 0, categories: [] });
  });

  it("does not build a shadow or report in legacy mode", async () => {
    const legacy = await runTextFixture({ mode: "legacy" });
    assertEquals(legacy.report, undefined);
  });
});

describe("processStream active mode", () => {
  it("rejects a pre-opened stream result", async () => {
    const { controller, encoder } = createSSECollector();

    await assertRejects(
      async () =>
        await processStream(
          createMockResult([
            { type: "finish", finishReason: "stop", totalUsage: null },
          ]),
          createStreamState(),
          controller,
          encoder,
          "text-1",
          { streamLifecycleMode: "active" },
          undefined,
        ),
      TypeError,
      "Active stream lifecycle mode requires a RuntimeStreamSource",
    );
  });

  async function runMode(mode: "legacy" | "active", parts: Record<string, unknown>[]) {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();
    const chunks: string[] = [];
    let usage: unknown;
    const result = createMockResult(parts);
    await processStream(
      mode === "active" ? createRuntimeStreamSource(() => result) : result,
      state,
      controller,
      encoder,
      "text-1",
      {
        streamLifecycleMode: mode,
        onChunk: (chunk) => chunks.push(chunk),
        onUsage: (next) => usage = next,
        providerExecutedToolNames: ["web_search"],
        availableToolNames: ["create_file", "web_search"],
      },
      undefined,
    );
    return { events, state, chunks, usage };
  }

  async function assertModeParity(parts: Record<string, unknown>[]) {
    const legacy = await runMode("legacy", parts);
    const active = await runMode("active", parts);

    assertEquals(active.events, legacy.events);
    assertEquals(active.chunks, legacy.chunks);
    assertEquals(active.usage, legacy.usage);
    assertEquals(active.state.accumulatedText, legacy.state.accumulatedText);
    assertEquals(active.state.finishReason, legacy.state.finishReason);
    assertEquals(active.state.reasoningParts, legacy.state.reasoningParts);
    assertEquals(
      active.state.suppressedToolCalls,
      legacy.state.suppressedToolCalls,
    );
    assertEquals(active.state.usage, legacy.state.usage);
    assertEquals(
      [...active.state.toolCalls.values()].map((tool) => ({
        id: tool.id,
        name: tool.name,
        arguments: tool.arguments,
        inputAvailable: tool.inputAvailable,
      })),
      [...legacy.state.toolCalls.values()].map((tool) => ({
        id: tool.id,
        name: tool.name,
        arguments: tool.arguments,
        inputAvailable: tool.inputAvailable,
      })),
    );
    assertEquals(
      active.state.toolResults.map((result) => ({
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
        error: result.error,
        providerExecuted: result.providerExecuted,
        dynamic: result.dynamic,
        preliminary: result.preliminary,
      })),
      legacy.state.toolResults.map((result) => ({
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
        error: result.error,
        providerExecuted: result.providerExecuted,
        dynamic: result.dynamic,
        preliminary: result.preliminary,
      })),
    );
    return { legacy, active };
  }

  it("matches legacy SSE and state for accumulated text", async () => {
    const { active } = await assertModeParity([
      { type: "text-delta", text: "Hello " },
      { type: "text-delta", text: "world" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);
    assertEquals(active.state.streamOutcome?.status, "completed");
  });

  it("matches legacy SSE and state for reasoning segments", async () => {
    await assertModeParity([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "thinking" },
      { type: "reasoning-end", id: "r1", signature: "sig" },
      { type: "text-delta", text: "answer" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);
  });

  it("matches legacy SSE and preserves resumed text after a tool interruption", async () => {
    const { active } = await assertModeParity([
      { type: "text-delta", text: "Before tool." },
      { type: "tool-input-start", id: "native-1", toolName: "web_search" },
      {
        type: "tool-input-available",
        toolCallId: "native-1",
        toolName: "web_search",
        input: { query: "x" },
      },
      {
        type: "tool-result",
        toolCallId: "native-1",
        toolName: "web_search",
        result: { answer: 42 },
      },
      { type: "text-delta", text: "I've opened the panel." },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    assertEquals(
      active.events.filter((event) =>
        typeof event.type === "string" && event.type.startsWith("text-")
      ),
      [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Before tool." },
        { type: "text-end", id: "text-1" },
        { type: "text-start", id: "text-1:1" },
        { type: "text-delta", id: "text-1:1", delta: "I've opened the panel." },
        { type: "text-end", id: "text-1:1" },
      ],
    );
  });

  it("matches legacy SSE and state for a committed local tool call", async () => {
    const { active } = await assertModeParity([
      { type: "tool-input-start", id: "local-1", toolName: "create_file" },
      { type: "tool-input-delta", id: "local-1", delta: '{"path":"a.md"}' },
      { type: "tool-input-end", id: "local-1" },
      { type: "finish", finishReason: "tool-calls", totalUsage: null },
    ]);
    assertEquals(active.state.streamOutcome?.status, "tool_handoff");
  });

  it("matches legacy SSE and state for a provider-executed tool", async () => {
    await assertModeParity([
      { type: "tool-input-start", id: "native-1", toolName: "web_search" },
      { type: "tool-input-delta", id: "native-1", delta: '{"query":"x"}' },
      {
        type: "tool-input-available",
        toolCallId: "native-1",
        toolName: "web_search",
        input: { query: "x" },
      },
      {
        type: "tool-result",
        toolCallId: "native-1",
        toolName: "web_search",
        result: { answer: 42 },
      },
      {
        type: "tool-result",
        toolCallId: "native-1",
        toolName: "web_search",
        result: { answer: "duplicate" },
      },
      { type: "text-delta", text: "done" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);
  });

  it("matches legacy normalized provider-tool error SSE and dynamic propagation", async () => {
    const { active } = await assertModeParity([
      {
        type: "tool-result",
        toolCallId: "native-error",
        toolName: "web_search",
        input: { query: "x" },
        output: { error: "tool_error", message: "Search failed" },
        dynamic: true,
        preliminary: false,
      },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    assertEquals(active.events, [
      {
        type: "tool-input-start",
        toolCallId: "native-error",
        toolName: "web_search",
        dynamic: true,
      },
      {
        type: "tool-input-available",
        toolCallId: "native-error",
        toolName: "web_search",
        input: { query: "x" },
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: "tool-output-error",
        toolCallId: "native-error",
        errorText: "Search failed",
        providerExecuted: true,
        dynamic: true,
      },
    ]);
  });

  it("matches legacy reconnect auth actions as provider-tool output", async () => {
    const reconnectRequired = {
      error: "reconnect_required",
      integration: "gmail",
      connectUrl: "https://api.example.test/oauth/connect/gmail?projectId=project-1",
      message: "Reconnect Gmail to continue.",
    };

    const { active } = await assertModeParity([
      {
        type: "tool-result",
        toolCallId: "native-auth",
        toolName: "web_search",
        input: { query: "mail" },
        output: reconnectRequired,
        isError: true,
      },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    assertEquals(active.events.at(-1), {
      type: "tool-output-available",
      toolCallId: "native-auth",
      output: reconnectRequired,
      providerExecuted: true,
    });
  });

  it("emits active lifecycle outcome span attributes", async () => {
    const spanAttributes: Record<string, unknown> = {};
    const span: Span = {
      setAttribute(key, value) {
        spanAttributes[key] = value;
        return span;
      },
      setAttributes(values) {
        Object.assign(spanAttributes, values);
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
        return {
          traceId: "00000000000000000000000000000002",
          spanId: "0000000000000002",
          traceFlags: 1,
        };
      },
      updateName() {},
    };
    setGlobalTracerProvider({
      getTracer() {
        return {
          startSpan() {
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

    const { controller, encoder } = createSSECollector();
    await processStream(
      createRuntimeStreamSource(() =>
        createMockResult([
          { type: "text-delta", text: "hello" },
          { type: "finish", finishReason: "stop", totalUsage: null },
        ])
      ),
      createStreamState(),
      controller,
      encoder,
      "text-1",
      {
        streamLifecycleMode: "active",
        traceAttributes: {
          "gen_ai.provider.name": "openai",
          "gen_ai.request.model": "llama-3",
          "gen_ai.response.model": "gpt-5.4",
        },
      },
      undefined,
    );

    assertEquals(spanAttributes["stream.lifecycle.status"], "completed");
    assertEquals(spanAttributes["stream.lifecycle.phase"], "completed");
    assertEquals(spanAttributes["stream.lifecycle.mode"], "active");
  });

  it("matches legacy usage propagation", async () => {
    const { active, legacy } = await assertModeParity([
      { type: "text-delta", text: "hi" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          cacheReadInputTokens: 1,
          costUsd: 0.25,
          costSource: "gateway",
        },
      },
    ]);
    assertEquals(legacy.state.usage.promptTokens, 2);
    assertEquals(active.state.usage.promptTokens, 2);
  });

  it("matches legacy suppression of unavailable tools", async () => {
    await assertModeParity([
      { type: "tool-input-start", id: "missing-1", toolName: "missing_tool" },
      { type: "tool-input-delta", id: "missing-1", delta: '{"a":1}' },
      { type: "text-delta", text: "recovered" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);
  });
});

describe("active mode heartbeat regression", () => {
  it("heartbeat telemetry cannot extend tool input idle", async () => {
    const clock = new ManualMonotonicClock();
    let nextCalls = 0;
    let pendingResolve: ((r: IteratorResult<unknown>) => void) | null = null;
    const queue: IteratorResult<unknown>[] = [
      {
        done: false,
        value: { type: "tool-input-start", id: "t1", toolName: "create_file" },
      },
    ];
    const fullStream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            nextCalls++;
            const queued = queue.shift();
            if (queued) return Promise.resolve(queued);
            return new Promise<IteratorResult<unknown>>((resolve) => pendingResolve = resolve);
          },
          return() {
            pendingResolve?.({ done: true, value: undefined });
            pendingResolve = null;
            return Promise.resolve(
              { done: true, value: undefined } as IteratorResult<unknown>,
            );
          },
        };
      },
    };
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();
    const waitTick = () => new Promise((resolve) => setTimeout(resolve, 0));

    const outcome = processStream(
      createRuntimeStreamSource(() => ({
        fullStream,
        textStream: (async function* (): AsyncGenerator<string> {})(),
      })),
      state,
      controller,
      encoder,
      "text-1",
      {
        streamLifecycleMode: "active",
        availableToolNames: ["create_file"],
        providerExecutedToolNames: [],
        streamLifecyclePolicy: {
          clock,
          toolInputIdleTimeoutMs: 15_000,
          statusIntervalMs: 5_000,
        },
      },
      undefined,
    ).then(() => null, (error: unknown) => error);

    await waitTick();
    clock.advanceBy(5_000);
    await waitTick();
    clock.advanceBy(5_000);
    await waitTick();
    clock.advanceBy(5_000);
    const error = await outcome;

    assertEquals(error instanceof StreamLifecycleFailure, true);
    if (error instanceof StreamLifecycleFailure) {
      assertEquals(error.lifecycleError.code, "TOOL_INPUT_TIMEOUT");
    }
    assertEquals(
      events.filter((event) => (event as { type: string }).type === "data-tool-call-status"),
      [
        {
          type: "data-tool-call-status",
          data: { toolCallId: "t1", status: "pending_input" },
        },
        {
          type: "data-tool-call-status",
          data: { toolCallId: "t1", status: "pending_input" },
        },
      ],
    );
    assertEquals(nextCalls, 2);
  });
});

describe("active mode delivery failure precedence", () => {
  it("keeps a delivery failure primary over the consumer_stopped outcome", async () => {
    const deliveryError = new Error("delivery sentinel");
    const throwingController = {
      enqueue() {
        throw deliveryError;
      },
    } as unknown as ReadableStreamDefaultController;
    const state = createStreamState();
    let caught: unknown;
    try {
      await processStream(
        createRuntimeStreamSource(() =>
          createMockResult([
            { type: "text-delta", text: "hello" },
            { type: "finish", finishReason: "stop", totalUsage: null },
          ])
        ),
        state,
        throwingController,
        new TextEncoder(),
        "text-1",
        { streamLifecycleMode: "active" },
        undefined,
      );
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, deliveryError);
    assertEquals(state.streamOutcome?.status, "cancelled");
    if (state.streamOutcome?.status === "cancelled") {
      assertEquals(state.streamOutcome.source, "consumer_stopped");
    }
  });
});

describe("chat-stream-handler provider-executed tool finalization", () => {
  /**
   * Stream source whose parts can be separated by real delays.
   * `cleanup()` clears any timer left pending when the stream is truncated.
   */
  function createDelayedResult(
    steps: Array<{ chunk: Record<string, unknown>; delayMs?: number }>,
  ) {
    const pendingTimers = new Set<number>();
    const fullStream = {
      async *[Symbol.asyncIterator]() {
        for (const step of steps) {
          if (step.delayMs) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => {
                pendingTimers.delete(timer);
                resolve();
              }, step.delayMs);
              pendingTimers.add(timer);
            });
          }
          yield step.chunk;
        }
      },
    };
    const textStream = { async *[Symbol.asyncIterator]() {} };
    const cleanup = () => {
      for (const timer of pendingTimers) clearTimeout(timer);
      pendingTimers.clear();
    };
    return { fullStream, textStream, cleanup };
  }

  /** Stream result driven by an arbitrary generator, for abort and throw paths. */
  function createGeneratorResult(
    body: () => AsyncGenerator<Record<string, unknown>>,
  ) {
    return {
      fullStream: { [Symbol.asyncIterator]: body },
      textStream: { async *[Symbol.asyncIterator]() {} },
    };
  }

  /** Replay collected SSE events back as the data stream the UI assembler reads. */
  function createSseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
    const sseEncoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      },
    });
  }

  it("leaves a local web_fetch input-available tool unresolved (regression guard for #3043)", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createMockResult([
      { type: "tool-input-start", id: "local-fetch", toolName: "web_fetch" },
      { type: "tool-input-delta", id: "local-fetch", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "local-fetch" },
      { type: "finish", finishReason: "tool-calls", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: [],
    });

    assertEquals(state.toolResults, []);
    assertEquals(state.toolCalls.get("local-fetch")?.providerExecuted, undefined);
    assertEquals(
      events.filter((event) =>
        event.type === "tool-output-available" || event.type === "tool-output-error"
      ),
      [],
    );
  });

  it("emits exactly one terminal event when a provider tool result arrives", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createMockResult([
      {
        type: "tool-input-start",
        id: "srvtoolu_01",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_01", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_01" },
      {
        type: "tool-result",
        toolCallId: "srvtoolu_01",
        toolName: "web_fetch",
        result: { type: "web_fetch_result", url: "https://a.test" },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "srvtoolu_01",
        toolName: "web_fetch",
        result: { type: "web_fetch_result", url: "https://duplicate.test" },
        providerExecuted: true,
      },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    const terminalEvents = events.filter((event) =>
      event.type === "tool-output-available" || event.type === "tool-output-error"
    );
    assertEquals(terminalEvents, [{
      type: "tool-output-available",
      toolCallId: "srvtoolu_01",
      output: { type: "web_fetch_result", url: "https://a.test" },
      providerExecuted: true,
    }]);
    assertEquals(state.toolResults.length, 1);
  });

  it("associates one terminal result with each parallel provider fetch", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();
    const calls = [
      ["fetch-skill", "https://docs.example/create-skill.md"],
      ["fetch-agent", "https://docs.example/create-agent.md"],
      ["fetch-schedule", "https://docs.example/schedule-agent.md"],
    ] as const;
    const chunks: Array<Record<string, unknown>> = [];

    for (const [toolCallId, url] of calls) {
      chunks.push(
        {
          type: "tool-input-start",
          id: toolCallId,
          toolName: "web_fetch",
          providerExecuted: true,
        },
        { type: "tool-input-delta", id: toolCallId, delta: JSON.stringify({ url }) },
        { type: "tool-input-end", id: toolCallId },
      );
    }
    for (const [toolCallId, url] of [...calls].reverse()) {
      chunks.push({
        type: "tool-result",
        toolCallId,
        toolName: "web_fetch",
        result: { type: "web_fetch_result", url, content: `content:${toolCallId}` },
        providerExecuted: true,
      });
    }
    chunks.push({ type: "finish", finishReason: "stop", totalUsage: null });

    await processStream(createMockResult(chunks as never), state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    const terminalEvents = events.filter((event) =>
      event.type === "tool-output-available" || event.type === "tool-output-error"
    );
    assertEquals(terminalEvents.length, calls.length);
    assertEquals(state.toolResults.length, calls.length);
    for (const [toolCallId, url] of calls) {
      const matchingEvents = terminalEvents.filter((event) => event.toolCallId === toolCallId);
      const matchingResults = state.toolResults.filter((result) =>
        result.toolCallId === toolCallId
      );
      assertEquals(matchingEvents.length, 1);
      assertEquals(matchingResults.length, 1);
      assertEquals(matchingResults[0]?.output, {
        type: "web_fetch_result",
        url,
        content: `content:${toolCallId}`,
      });
    }
    assertEquals(shouldContinueAfterStreamStep(state), true);
  });

  it("finalizes a provider tool call that never produced a result", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createMockResult([
      {
        type: "tool-input-start",
        id: "srvtoolu_02",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_02", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_02" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    const terminalEvents = events.filter((event) =>
      event.type === "tool-output-available" || event.type === "tool-output-error"
    );
    assertEquals(terminalEvents.length, 1);
    assertEquals(terminalEvents[0]?.type, "tool-output-error");
    assertEquals(terminalEvents[0]?.toolCallId, "srvtoolu_02");
    assertEquals(terminalEvents[0]?.providerExecuted, true);
  });

  it("finalizes a provider tool call that only produced a preliminary result", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    // Preliminary output is progress, not proof the provider answered. A
    // stream that ends after only preliminary output still needs an explicit
    // terminal error so the card cannot remain stranded.
    const result = createMockResult([
      {
        type: "tool-input-start",
        id: "srvtoolu_prelim_only",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_prelim_only", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_prelim_only" },
      {
        type: "tool-result",
        toolCallId: "srvtoolu_prelim_only",
        toolName: "web_fetch",
        result: { type: "web_fetch_result", url: "https://a.test", partial: true },
        providerExecuted: true,
        preliminary: true,
      },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    const errorEvents = events.filter((event) => event.type === "tool-output-error");
    assertEquals(errorEvents.length, 1);
    assertEquals(errorEvents[0]?.toolCallId, "srvtoolu_prelim_only");
    assertEquals(errorEvents[0]?.providerExecuted, true);
  });

  it("keeps the synthesized terminal event out of the runtime continuation decision", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createMockResult([
      {
        type: "tool-input-start",
        id: "srvtoolu_06",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_06", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_06" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    assertEquals(
      events.filter((event) => event.type === "tool-output-error").length,
      1,
    );
    // The provider genuinely produced nothing. Recording a result here would
    // make the runtime re-call the model once per unresolved call until
    // maxSteps, and persist a tool result the provider never returned.
    assertEquals(state.toolResults, []);
    assertEquals(shouldContinueAfterStreamStep(state), false);
  });

  it("settles the unresolved provider tool part at output-error so persistence keeps it", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createMockResult([
      {
        type: "tool-input-start",
        id: "srvtoolu_05",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_05", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_05" },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
    });

    let responseMessage: ChatUiMessage | undefined;
    const uiStream = createChatUiMessageStreamFromDataStream(
      { stream: createSseStream(events) },
      {
        generateMessageId: () => "assistant-message",
        onFinish: (finish) => {
          responseMessage = finish.responseMessage;
        },
      },
    );
    for await (const _chunk of uiStream) {
      // Drain: the assembled message is delivered through onFinish.
    }

    const toolParts = responseMessage?.parts.filter(isToolUiPart) ?? [];
    assertEquals(toolParts.length, 1);
    // `input-available` is what the Studio card renders as an endless spinner
    // and what persistence judges incomplete.
    assertEquals(toolParts[0]?.state, "output-error");
    assertEquals(hasIncompleteToolParts(responseMessage!), false);

    assertEquals(
      toConversationPartsFromUiMessage(responseMessage!).filter((part) =>
        part.type === "tool_result"
      ),
      [{
        type: "tool_result",
        tool_call_id: "srvtoolu_05",
        output:
          'Provider-executed tool "web_fetch" returned no result before the model turn ended.',
        is_error: true,
      }],
    );
  });

  it("does not truncate a pending provider tool call after a local tool commits", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createDelayedResult([
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_03",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      { chunk: { type: "tool-input-delta", id: "srvtoolu_03", delta: '{"url":"https://a.test"}' } },
      { chunk: { type: "tool-input-end", id: "srvtoolu_03" } },
      { chunk: { type: "tool-input-start", id: "local-1", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-1", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-1" } },
      {
        chunk: {
          type: "tool-result",
          toolCallId: "srvtoolu_03",
          toolName: "web_fetch",
          result: { type: "web_fetch_result", url: "https://a.test" },
          providerExecuted: true,
        },
        delayMs: 200,
      },
      { chunk: { type: "finish", finishReason: "tool-calls", totalUsage: null } },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
    });
    result.cleanup();

    assertEquals(events.filter((event) => event.type === "tool-output-available"), [{
      type: "tool-output-available",
      toolCallId: "srvtoolu_03",
      output: { type: "web_fetch_result", url: "https://a.test" },
      providerExecuted: true,
    }]);
  });

  it("keeps a provider tool call pending across a preliminary result", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    // A preliminary result is not terminal. Releasing the call on it re-arms the
    // local commit grace, which truncates the stream before the final provider
    // result arrives: the same failure this tracking exists to prevent.
    const result = createDelayedResult([
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_prelim",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      {
        chunk: {
          type: "tool-input-delta",
          id: "srvtoolu_prelim",
          delta: '{"url":"https://a.test"}',
        },
      },
      { chunk: { type: "tool-input-end", id: "srvtoolu_prelim" } },
      { chunk: { type: "tool-input-start", id: "local-prelim", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-prelim", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-prelim" } },
      {
        chunk: {
          type: "tool-result",
          toolCallId: "srvtoolu_prelim",
          toolName: "web_fetch",
          result: { type: "web_fetch_result", url: "https://a.test", partial: true },
          providerExecuted: true,
          preliminary: true,
        },
      },
      {
        chunk: {
          type: "tool-result",
          toolCallId: "srvtoolu_prelim",
          toolName: "web_fetch",
          result: { type: "web_fetch_result", url: "https://a.test" },
          providerExecuted: true,
        },
        delayMs: 200,
      },
      { chunk: { type: "finish", finishReason: "tool-calls", totalUsage: null } },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
    });
    result.cleanup();

    const outputs = events.filter((event) => event.type === "tool-output-available");
    assertEquals(outputs, [{
      type: "tool-output-available",
      toolCallId: "srvtoolu_prelim",
      output: { type: "web_fetch_result", url: "https://a.test" },
      providerExecuted: true,
    }]);
    assertEquals(state.toolResults, [{
      toolCallId: "srvtoolu_prelim",
      toolName: "web_fetch",
      output: { type: "web_fetch_result", url: "https://a.test" },
      providerExecuted: true,
    }]);
  });

  it("still truncates after a committed local tool call when no provider call is pending", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createDelayedResult([
      { chunk: { type: "tool-input-start", id: "local-2", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-2", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-2" } },
      { chunk: { type: "finish", finishReason: "stop", totalUsage: null }, delayMs: 200 },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
    });
    result.cleanup();

    assertEquals(state.finishReason, "tool-calls");
  });

  it("still truncates when a provider tool call never completed its input", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    // The provider call never reaches `tool-input-end`, so nothing can ever
    // resolve it. It must not hold the local commit grace open for the step.
    const result = createDelayedResult([
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_04",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      { chunk: { type: "tool-input-delta", id: "srvtoolu_04", delta: '{"url":"https://a.te' } },
      { chunk: { type: "tool-input-start", id: "local-3", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-3", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-3" } },
      { chunk: { type: "finish", finishReason: "stop", totalUsage: null }, delayMs: 200 },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
    });
    result.cleanup();

    assertEquals(state.finishReason, "tool-calls");
  });

  it("still classifies a held-open timeout as tool-calls so committed local tools run", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    // The reported shape: a provider web_fetch that never resolves plus a
    // committed local tool. Holding the stream open must not turn the eventual
    // timeout into "stop", which strands the local tool unexecuted.
    const result = createDelayedResult([
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_07",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      { chunk: { type: "tool-input-delta", id: "srvtoolu_07", delta: '{"url":"https://a.test"}' } },
      { chunk: { type: "tool-input-end", id: "srvtoolu_07" } },
      { chunk: { type: "tool-input-start", id: "local-4", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-4", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-4" } },
      { chunk: { type: "finish", finishReason: "stop", totalUsage: null }, delayMs: 5_000 },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
      streamIdleTimeoutMs: 300,
    });
    result.cleanup();

    assertEquals(state.finishReason, "tool-calls");
    assertEquals(shouldContinueAfterStreamStep(state), true);
    assertEquals(
      events.filter((event) => event.type === "tool-output-error").map((event) => event.toolCallId),
      ["srvtoolu_07"],
    );
  });

  it("reports no shadow divergence for an unresolved provider tool call", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();
    let report: StreamLifecycleShadowReport | undefined;

    await processStream(
      createMockResult([
        {
          type: "tool-input-start",
          id: "srvtoolu_08",
          toolName: "web_fetch",
          providerExecuted: true,
        },
        { type: "tool-input-delta", id: "srvtoolu_08", delta: '{"url":"https://a.test"}' },
        { type: "tool-input-end", id: "srvtoolu_08" },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]),
      state,
      controller,
      encoder,
      "t",
      {
        providerExecutedToolNames: ["web_fetch"],
        streamLifecycleMode: "shadow",
        onLifecycleShadowReport: (next) => report = next,
      },
      undefined,
    );

    assertEquals(report, { count: 0, categories: [] });
  });

  it("does not treat a suppressed tool call id as a pending provider call", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    // The same id is announced first under an unavailable name (suppressed) and
    // then under an available provider-executed one. Nothing will ever resolve
    // the suppressed call, so it must not disable the local commit grace.
    const result = createDelayedResult([
      { chunk: { type: "tool-input-start", id: "shared-id", toolName: "banned_tool" } },
      {
        chunk: {
          type: "tool-call",
          toolCallId: "shared-id",
          toolName: "web_fetch",
          input: { url: "https://a.test" },
        },
      },
      { chunk: { type: "tool-input-start", id: "local-5", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-5", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-5" } },
      { chunk: { type: "finish", finishReason: "stop", totalUsage: null }, delayMs: 200 },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
      availableToolNames: ["web_fetch", "list_skills"],
      streamIdleTimeoutMs: 1_000,
    });
    result.cleanup();

    assertEquals(state.finishReason, "tool-calls");
  });

  it("stops holding the grace open when a tracked provider call restarts its input", async () => {
    const { controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createDelayedResult([
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_09",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      { chunk: { type: "tool-input-delta", id: "srvtoolu_09", delta: '{"url":"https://a.test"}' } },
      { chunk: { type: "tool-input-end", id: "srvtoolu_09" } },
      // Restart: the call drops back to an unfinished input nothing can resolve.
      {
        chunk: {
          type: "tool-input-start",
          id: "srvtoolu_09",
          toolName: "web_fetch",
          providerExecuted: true,
        },
      },
      { chunk: { type: "tool-input-delta", id: "srvtoolu_09", delta: '{"url":"https://b.te' } },
      { chunk: { type: "tool-input-start", id: "local-6", toolName: "list_skills" } },
      { chunk: { type: "tool-input-delta", id: "local-6", delta: "{}" } },
      { chunk: { type: "tool-input-end", id: "local-6" } },
      { chunk: { type: "finish", finishReason: "stop", totalUsage: null }, delayMs: 200 },
    ]);

    await processStream(result, state, controller, encoder, "t", {
      providerExecutedToolNames: ["web_fetch"],
      localToolCommitGraceMs: 40,
      streamIdleTimeoutMs: 1_000,
    });
    result.cleanup();

    assertEquals(state.finishReason, "tool-calls");
  });

  it("finalizes an unresolved provider tool call when the stream aborts", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();
    const abortController = new AbortController();

    const result = createGeneratorResult(async function* () {
      yield {
        type: "tool-input-start",
        id: "srvtoolu_10",
        toolName: "web_fetch",
        providerExecuted: true,
      };
      yield { type: "tool-input-delta", id: "srvtoolu_10", delta: '{"url":"https://a.test"}' };
      yield { type: "tool-input-end", id: "srvtoolu_10" };
      abortController.abort();
      yield { type: "text-delta", text: "late" };
    });

    await assertRejects(() =>
      processStream(result, state, controller, encoder, "t", {
        providerExecutedToolNames: ["web_fetch"],
      }, abortController.signal)
    );

    assertEquals(
      events.filter((event) => event.type === "tool-output-error").map((event) => event.toolCallId),
      ["srvtoolu_10"],
    );
  });

  it("finalizes unresolved provider calls in active lifecycle mode", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const parts = [
      {
        type: "tool-input-start",
        id: "srvtoolu_active",
        toolName: "web_fetch",
        providerExecuted: true,
      },
      { type: "tool-input-delta", id: "srvtoolu_active", delta: '{"url":"https://a.test"}' },
      { type: "tool-input-end", id: "srvtoolu_active" },
      {
        type: "tool-result",
        toolCallId: "srvtoolu_active",
        toolName: "web_fetch",
        result: { type: "web_fetch_result", url: "https://a.test", partial: true },
        providerExecuted: true,
        preliminary: true,
      },
      { type: "finish", finishReason: "stop", totalUsage: null },
    ];

    await processStream(
      createRuntimeStreamSource(() => createMockResult(parts)),
      state,
      controller,
      encoder,
      "t",
      {
        streamLifecycleMode: "active",
        providerExecutedToolNames: ["web_fetch"],
      },
      undefined,
    );

    assertEquals(events.filter((event) => event.type === "tool-output-error"), [{
      type: "tool-output-error",
      toolCallId: "srvtoolu_active",
      errorText:
        'Provider-executed tool "web_fetch" returned no result before the model turn ended.',
      providerExecuted: true,
    }]);
    assertEquals(state.toolCalls.get("srvtoolu_active")?.inputAvailable, true);
    assertEquals(state.toolResults, []);
  });

  it("finalizes an unresolved provider tool call when the stream throws", async () => {
    const { events, controller, encoder } = createSSECollector();
    const state = createStreamState();

    const result = createGeneratorResult(async function* () {
      yield {
        type: "tool-input-start",
        id: "srvtoolu_11",
        toolName: "web_fetch",
        providerExecuted: true,
      };
      yield { type: "tool-input-delta", id: "srvtoolu_11", delta: '{"url":"https://a.test"}' };
      yield { type: "tool-input-end", id: "srvtoolu_11" };
      throw new Error("provider stream failed");
    });

    await assertRejects(
      () =>
        processStream(result, state, controller, encoder, "t", {
          providerExecutedToolNames: ["web_fetch"],
        }),
      Error,
      "provider stream failed",
    );

    assertEquals(
      events.filter((event) => event.type === "tool-output-error").map((event) => event.toolCallId),
      ["srvtoolu_11"],
    );
  });
});
