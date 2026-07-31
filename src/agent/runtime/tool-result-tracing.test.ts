import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  type Context,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  type Span,
  SpanStatusCode,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../index.ts";

afterEach(() => {
  _resetShimForTests();
});

describe("agent runtime tool result tracing", () => {
  it("ends tool spans with ERROR status for returned structured failures", async () => {
    function createContext(values = new Map<symbol, unknown>()): Context {
      return {
        getValue: (key) => values.get(key),
        setValue(key, value) {
          const next = new Map(values);
          next.set(key, value);
          return createContext(next);
        },
        deleteValue(key) {
          const next = new Map(values);
          next.delete(key);
          return createContext(next);
        },
      };
    }

    let activeContext = createContext();
    const spans: Array<{ name: string; status?: { code: number; message?: string } }> = [];

    setGlobalContextAccessor({
      active: () => activeContext,
      with: (context, fn) => {
        const previous = activeContext;
        activeContext = context;
        try {
          const result = fn();
          if (result && typeof (result as { finally?: unknown }).finally === "function") {
            return (result as unknown as Promise<unknown>).finally(() => {
              activeContext = previous;
            }) as never;
          }
          activeContext = previous;
          return result;
        } catch (error) {
          activeContext = previous;
          throw error;
        }
      },
    });
    setGlobalTracerProvider({
      getTracer() {
        return {
          startSpan(name) {
            const captured: { name: string; status?: { code: number; message?: string } } = {
              name,
            };
            spans.push(captured);
            const span: Span = {
              setAttribute() {
                return span;
              },
              setAttributes() {
                return span;
              },
              setStatus(status) {
                if (
                  status.code === SpanStatusCode.UNSET ||
                  captured.status?.code === SpanStatusCode.OK
                ) {
                  return span;
                }
                captured.status = status;
                return span;
              },
              recordException() {},
              addEvent() {
                return span;
              },
              end() {},
              spanContext() {
                const sequence = spans.length.toString(16);
                return {
                  traceId: sequence.padStart(32, "0"),
                  spanId: sequence.padStart(16, "0"),
                  traceFlags: 1,
                };
              },
              updateName() {},
            };
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
            return callback(this.startSpan("active"));
          },
        };
      },
    });

    let callCount = 0;
    const model: ModelRuntime = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate() {
        callCount++;
        if (callCount === 1) {
          return {
            content: [{
              type: "tool-call",
              toolCallId: "update-agent-trace-1",
              toolName: "update_agent",
              input: '{"id":"jira-agent"}',
            }],
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          };
        }

        return {
          content: [{ type: "text", text: "I can recover from that failure." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const updateAgent = tool({
      id: "update_agent",
      description: "Update a Studio project agent",
      inputSchema: defineSchema((value) => value.object({ id: value.string() }))(),
      execute: () => ({
        error: "tool_error",
        message: "system or system_prompt is required",
      }),
    });
    const assistant = agent({
      model: "anthropic/claude-sonnet-4-6",
      system: "Update agents and recover from failed tool calls.",
      tools: { update_agent: updateAgent },
      maxSteps: 2,
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "Attach a skill to my Jira agent" });

    const toolSpanStatuses = spans
      .filter((span) => span.name === "agent.tool_execute")
      .map((span) => span.status?.code);
    assertEquals(toolSpanStatuses, [SpanStatusCode.ERROR, SpanStatusCode.ERROR]);
  });
});
