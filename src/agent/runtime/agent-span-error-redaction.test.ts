import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Tool, tool } from "#veryfront/tool";
import { agent } from "../index.ts";
import * as otelApi from "npm:@opentelemetry/api@1.9.1";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.9.0";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  SpanStatusCode,
} from "#veryfront/observability/tracing/api-shim.ts";

/**
 * The real SDK, wired the way server bootstrap wires it. A hand-rolled tracer
 * double cannot show what actually reaches an exporter, which is the only thing
 * this file is about.
 */
function installRealTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  otelApi.context.setGlobalContextManager(contextManager);
  setGlobalTracerProvider(provider as never);
  setGlobalActiveSpanAccessor(otelApi.trace as never);
  setGlobalContextAccessor(otelApi.context as never);
  return {
    exporter,
    provider,
    async dispose() {
      _resetShimForTests();
      contextManager.disable();
      otelApi.context.disable();
      await provider.shutdown();
    },
  };
}

/**
 * Check every field that leaves the process, naming which one leaked.
 *
 * `exception.stacktrace` is asserted separately from `exception.message`: a
 * stack trace carries filesystem paths and interpolated values the other two
 * fields do not, and it is recorded by `recordException` rather than written
 * by the caller, so it is easy to miss.
 */
function assertNoSpanCarries(spans: readonly ReadableSpan[], needle: string): void {
  for (const span of spans) {
    assertEquals(
      (span.status.message ?? "").includes(needle),
      false,
      `${span.name} leaked the error text into status.message`,
    );
    for (const [key, value] of Object.entries(span.attributes)) {
      assertEquals(
        String(value).includes(needle),
        false,
        `${span.name} leaked the error text into the ${key} attribute`,
      );
    }
    for (const event of span.events) {
      for (const [key, value] of Object.entries(event.attributes ?? {})) {
        assertEquals(
          String(value).includes(needle),
          false,
          `${span.name} leaked the error text into ${event.name}.${key}`,
        );
      }
    }
  }
}

function erroredSpans(spans: readonly ReadableSpan[], name: string): ReadableSpan[] {
  return spans.filter((span) => span.name === name && span.status.code === SpanStatusCode.ERROR);
}

function createModel(onGenerate?: () => never): ModelRuntime {
  let callCount = 0;
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    // deno-lint-ignore require-await
    async doGenerate() {
      onGenerate?.();
      callCount++;
      if (callCount === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: "redaction-call-1",
            toolName: "probe_tool",
            input: '{"id":"x"}',
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: [{ type: "text", text: "recovered" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    // deno-lint-ignore require-await
    async doStream() {
      return { stream: new ReadableStream() };
    },
  };
}

const inputSchema = defineSchema((value) => value.object({ id: value.string() }))();

function createAgent<TInput, TOutput>(
  probeTool: Tool<TInput, TOutput>,
  onGenerate?: () => never,
) {
  return agent({
    model: "anthropic/claude-sonnet-4-6",
    system: "probe",
    tools: { probe_tool: probeTool },
    maxSteps: 2,
    resolveModelTransport: async () => ({ model: createModel(onGenerate) }),
  });
}

describe("agent span error redaction", () => {
  it("keeps a returned tool error's text off every agent span", async () => {
    const tracing = installRealTracing();
    try {
      // A tool that RETURNS a structured error never throws, so no span catch
      // runs. This path reported the raw text through an explicit status write
      // and an "error.message" attribute, and it is the ordinary failed-tool
      // path rather than an exceptional one.
      const needle = "returned-tool-error@example.com";
      const assistant = createAgent(tool({
        id: "probe_tool",
        description: "probe",
        inputSchema,
        execute: () => ({ error: "tool_error", message: `lookup failed for ${needle}` }),
      }));

      await assistant.generate({ input: "go" });
      await tracing.provider.forceFlush();
      const spans = tracing.exporter.getFinishedSpans();

      assertNoSpanCarries(spans, needle);

      // The failure must still be visible to errored-span queries.
      const failed = erroredSpans(spans, "agent.tool_execute");
      assertEquals(failed.length > 0, true, "a failed tool must still mark its span ERROR");
      for (const span of failed) {
        assertEquals(span.status.message, 'Tool "probe_tool" failed');
        assertEquals(span.attributes["error.message"], undefined);
      }
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps a thrown tool error's text off every agent span", async () => {
    const tracing = installRealTracing();
    try {
      const needle = "thrown-tool-error@example.com";
      const assistant = createAgent(tool({
        id: "probe_tool",
        description: "probe",
        inputSchema,
        execute: () => {
          throw new Error(`tool exploded for ${needle}`);
        },
      }));

      await assistant.generate({ input: "go" }).catch(() => {});
      await tracing.provider.forceFlush();
      const spans = tracing.exporter.getFinishedSpans();

      assertNoSpanCarries(spans, needle);
      assertEquals(
        erroredSpans(spans, "agent.tool_execute").length > 0,
        true,
        "a thrown tool error must still mark its span ERROR",
      );
    } finally {
      await tracing.dispose();
    }
  });

  it("keeps a thrown provider error's text off the whole enclosing span stack", async () => {
    const tracing = installRealTracing();
    try {
      // One escaped throw is reported by every span it unwinds through, so a
      // fix confined to one module leaves the rest of the stack leaking.
      const needle = "provider-error@example.com";
      const assistant = createAgent(
        tool({
          id: "probe_tool",
          description: "probe",
          inputSchema,
          execute: () => ({ ok: true }),
        }),
        () => {
          throw new Error(`upstream 401 for account ${needle}`);
        },
      );

      await assistant.generate({ input: "go" }).catch(() => {});
      await tracing.provider.forceFlush();
      const spans = tracing.exporter.getFinishedSpans();

      assertNoSpanCarries(spans, needle);

      // Every span in the stack reports the failure, bounded.
      for (const name of ["agent.generate_text", "agent.execution_loop", "agent.generate"]) {
        const failed = erroredSpans(spans, name);
        assertEquals(failed.length > 0, true, `${name} must still report the failure`);
        assertEquals(failed[0]?.status.message, "Error");
      }
    } finally {
      await tracing.dispose();
    }
  });

  it("classifies an unmapped span error instead of forwarding its message", async () => {
    const tracing = installRealTracing();
    try {
      // The load-bearing default: a withSpan caller that passes no errorStatus
      // mapper must not put the thrown message on the wire. Every agent span,
      // and every span in ext-redis, relies on this.
      const { withSpan } = await import("#veryfront/observability/tracing/otlp-setup.ts");
      const needle = "unmapped-span@example.com";

      await withSpan("probe.unmapped", async () => {
        const error = new Error(`failed for ${needle}`);
        (error as { code?: string }).code = "ECONNRESET";
        throw error;
      }).catch(() => {});
      await tracing.provider.forceFlush();

      const spans = tracing.exporter.getFinishedSpans();
      assertNoSpanCarries(spans, needle);

      const span = spans.find((candidate) => candidate.name === "probe.unmapped");
      assertExists(span);
      assertEquals(span.status.code, SpanStatusCode.ERROR);
      // The bounded classification still distinguishes a network failure.
      assertEquals(span.status.message, "ECONNRESET");
    } finally {
      await tracing.dispose();
    }
  });

  it("lets a caller opt a span back into the raw error", async () => {
    const tracing = installRealTracing();
    try {
      // The default is safe, not mandatory: a caller that wants detail says so.
      // Without this the escape hatch would be untested and could rot.
      const { withSpan } = await import("#veryfront/observability/tracing/otlp-setup.ts");

      await withSpan(
        "probe.opted-in",
        async () => {
          throw new Error("deliberately visible");
        },
        {},
        { errorStatus: (error) => error },
      ).catch(() => {});
      await tracing.provider.forceFlush();

      const span = tracing.exporter.getFinishedSpans().find((c) => c.name === "probe.opted-in");
      assertExists(span);
      assertEquals(span.status.message, "deliberately visible");
    } finally {
      await tracing.dispose();
    }
  });
});
